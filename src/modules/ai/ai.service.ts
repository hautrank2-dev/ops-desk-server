import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';
import { Model } from 'mongoose';
import {
  AiCard,
  AiConversation,
  AiConversationDocument,
  AiMessage,
} from 'src/schemas/ai-conversation.schema';
import { Ticket } from 'src/schemas/ticket.schema';
import { TicketComment } from 'src/schemas/ticket-comment.schema';
import { User } from 'src/schemas/user.schema';
import { TableResponse } from 'src/types/response';
import { QueryPagination } from 'src/types/query';
import { ANTHROPIC_CLIENT } from './ai.constants';
import { ChatDto } from './dto/chat.dto';
import { CHAT_SYSTEM_PROMPT } from './prompts/system';
import { AI_TOOL_MAP, AI_TOOLS, AiToolDeps } from './tools';

// Giới hạn số lượt gọi tool cho một câu hỏi; lượt cuối ép tool_choice none
// để model buộc phải trả lời bằng text (history luôn hợp lệ).
const MAX_TOOL_ROUNDS = 8;

export interface AiHealth {
  model: string;
  ok: boolean;
  error?: string;
}

export interface AiConversationListItem {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiConversationDetail extends AiConversationListItem {
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    cards: AiCard[];
    createdAt: Date;
  }>;
}

@Injectable()
export class AiService {
  private readonly toolDeps: AiToolDeps;

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly anthropic: Anthropic | null,
    private readonly configService: ConfigService,
    @InjectModel(AiConversation.name)
    private readonly conversationModel: Model<AiConversationDocument>,
    @InjectModel(Ticket.name) ticketModel: Model<Ticket>,
    @InjectModel(TicketComment.name) commentModel: Model<TicketComment>,
    @InjectModel(User.name) userModel: Model<User>,
  ) {
    this.toolDeps = { ticketModel, commentModel, userModel };
  }

  async checkHealth(): Promise<AiHealth> {
    const model = this.configService.get<string>('ai.fastModel') ?? '';

    if (!this.anthropic) {
      return {
        model,
        ok: false,
        error: 'ANTHROPIC_API_KEY chưa được cấu hình trong .env',
      };
    }

    try {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with just: OK' }],
      });
      const text = response.content.find(block => block.type === 'text');
      return {
        model: response.model,
        ok: !!text && text.text.trim().length > 0,
      };
    } catch (error) {
      return {
        model,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // SSE: meta (conversationId) -> (thinking | text | tool | card)* ->
  // done (usage) | error. Một câu hỏi có thể gồm nhiều lượt gọi API (tool use).
  async streamChat(
    userId: string,
    dto: ChatDto,
    req: Request,
    res: Response,
  ): Promise<void> {
    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (!this.anthropic) {
      writeEvent('error', {
        message: 'ANTHROPIC_API_KEY chưa được cấu hình trong .env',
      });
      res.end();
      return;
    }

    let conversation: AiConversationDocument | null;
    if (dto.conversationId) {
      conversation = await this.conversationModel.findOne({
        _id: dto.conversationId,
        userId,
      });
      if (!conversation) {
        writeEvent('error', {
          message: 'Không tìm thấy hội thoại hoặc bạn không có quyền truy cập',
        });
        res.end();
        return;
      }
    } else {
      conversation = await this.conversationModel.create({
        userId,
        title: null,
        messages: [],
      });
    }

    writeEvent('meta', { conversationId: String(conversation._id) });

    // Drop thinking blocks from past turns: their signature is bound to the
    // system prompt they were created with, so any prompt edit makes old
    // conversations fail with "Invalid signature in thinking block". They
    // are only required inside the current turn's tool loop (`messages`).
    const history = conversation.messages
      .map(m => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? (m.content as Anthropic.ContentBlockParam[]).filter(
              block =>
                block.type !== 'thinking' && block.type !== 'redacted_thinking',
            )
          : m.content,
      }))
      .filter(
        m => !Array.isArray(m.content) || m.content.length > 0,
      ) as Anthropic.MessageParam[];

    // Ngày giờ hiện tại + context trang đưa vào message user (không vào
    // system) để không làm vỡ prompt cache của system/tools.
    const contextLines = [`Current datetime: ${new Date().toISOString()}`];
    if (dto.context?.route) contextLines.push(`Page: ${dto.context.route}`);
    if (dto.context?.ticketId)
      contextLines.push(`Ticket: ${dto.context.ticketId}`);
    const userContent = `${contextLines.join('\n')}\n\n${dto.message}`;

    const model = this.configService.get<string>('ai.model') ?? '';
    const maxTokens = this.configService.get<number>('ai.maxTokens') ?? 16000;
    const effort =
      this.configService.get<'low' | 'medium' | 'high' | 'xhigh' | 'max'>(
        'ai.effortChat',
      ) ?? 'medium';

    const tools = AI_TOOLS.map(t => t.definition);
    // cache_control ở system => cache cả tools + system (tools đứng trước).
    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: CHAT_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ];

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: userContent },
    ];
    const newMessages: AiMessage[] = [
      {
        role: 'user',
        content: userContent,
        displayText: dto.message,
        createdAt: new Date(),
      },
    ];
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    let currentStream: { abort: () => void } | null = null;
    let aborted = false;
    const onClientClose = () => {
      aborted = true;
      currentStream?.abort();
    };
    req.on('close', onClientClose);

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (aborted) throw new Anthropic.APIUserAbortError();
        const stream = this.anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
          system,
          tools,
          tool_choice:
            round === MAX_TOOL_ROUNDS ? { type: 'none' } : { type: 'auto' },
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort },
          messages,
        });
        currentStream = stream;

        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              writeEvent('text', { text: event.delta.text });
            } else if (event.delta.type === 'thinking_delta') {
              writeEvent('thinking', { text: event.delta.thinking });
            }
          } else if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
          ) {
            writeEvent('tool', {
              id: event.content_block.id,
              name: event.content_block.name,
              status: 'running',
            });
          }
        }

        const finalMessage = await stream.finalMessage();
        usage.input_tokens += finalMessage.usage.input_tokens;
        usage.output_tokens += finalMessage.usage.output_tokens;
        usage.cache_read_input_tokens +=
          finalMessage.usage.cache_read_input_tokens ?? 0;
        usage.cache_creation_input_tokens +=
          finalMessage.usage.cache_creation_input_tokens ?? 0;

        if (finalMessage.stop_reason === 'refusal') {
          // Bỏ cả câu hỏi này (không lưu) để hội thoại sau vẫn hợp lệ.
          writeEvent('error', {
            message: 'Claude đã từ chối trả lời câu này.',
            category: finalMessage.stop_details?.category ?? null,
          });
          writeEvent('done', { usage });
          return;
        }

        messages.push({ role: 'assistant', content: finalMessage.content });
        const assistantMsg: AiMessage = {
          role: 'assistant',
          content: finalMessage.content,
          displayText: finalMessage.content
            .filter(
              (block): block is Anthropic.TextBlock => block.type === 'text',
            )
            .map(block => block.text)
            .join('\n'),
          createdAt: new Date(),
        };
        newMessages.push(assistantMsg);

        if (finalMessage.stop_reason === 'max_tokens') {
          writeEvent('error', {
            message: 'Phản hồi bị cắt do quá dài (max_tokens).',
          });
        }
        if (finalMessage.stop_reason !== 'tool_use') break;

        const toolUses = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );
        const results = await Promise.all(
          toolUses.map(block => this.runTool(block, writeEvent)),
        );
        const cards = results.flatMap(r => (r.card ? [r.card] : []));
        if (cards.length) assistantMsg.cards = cards;

        const toolResults = results.map(r => r.result);
        messages.push({ role: 'user', content: toolResults });
        newMessages.push({
          role: 'user',
          content: toolResults,
          displayText: '',
          createdAt: new Date(),
        });
      }

      conversation.messages.push(...newMessages);
      await conversation.save();

      if (!conversation.title) {
        this.generateTitle(String(conversation._id), dto.message).catch(
          (err: unknown) => console.error('generateTitle failed:', err),
        );
      }

      writeEvent('done', { usage });
    } catch (error) {
      writeEvent('error', { message: this.describeStreamError(error) });
    } finally {
      req.off('close', onClientClose);
      res.end();
    }
  }

  private async runTool(
    block: Anthropic.ToolUseBlock,
    writeEvent: (event: string, data: unknown) => void,
  ): Promise<{ result: Anthropic.ToolResultBlockParam; card?: AiCard }> {
    const fail = (message: string) => {
      writeEvent('tool', { id: block.id, name: block.name, status: 'error' });
      return {
        result: {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: message,
          is_error: true,
        },
      };
    };

    const tool = AI_TOOL_MAP.get(block.name);
    if (!tool) return fail(`Unknown tool: ${block.name}`);
    const parsed = tool.input.safeParse(block.input);
    if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);

    try {
      const output = await tool.run(parsed.data, this.toolDeps);
      writeEvent('tool', { id: block.id, name: block.name, status: 'done' });
      let card: AiCard | undefined;
      if (tool.card) {
        card = { type: tool.card, data: parsed.data };
        writeEvent('card', card);
      }
      return {
        result: {
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(output),
        },
        card,
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Tool failed');
    }
  }

  private describeStreamError(error: unknown): string {
    if (error instanceof Anthropic.RateLimitError) {
      return 'Đã đạt giới hạn tốc độ gọi AI, vui lòng thử lại sau.';
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return 'API key không hợp lệ, liên hệ quản trị.';
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return 'Không kết nối được tới dịch vụ AI, vui lòng thử lại.';
    }
    if (error instanceof Anthropic.APIUserAbortError) {
      return 'Đã huỷ.';
    }
    if (error instanceof Anthropic.APIError) {
      return `Lỗi từ dịch vụ AI: ${error.message}`;
    }
    return error instanceof Error ? error.message : 'Đã có lỗi không xác định.';
  }

  private async generateTitle(
    conversationId: string,
    firstMessage: string,
  ): Promise<void> {
    if (!this.anthropic) return;
    const fastModel = this.configService.get<string>('ai.fastModel') ?? '';
    const response = await this.anthropic.messages.create({
      model: fastModel,
      max_tokens: 40,
      // Việc đặt tiêu đề rất đơn giản — tắt thinking để toàn bộ max_tokens
      // dành cho câu trả lời (adaptive thinking mặc định bật trên Haiku có
      // thể ăn hết budget nhỏ này và không còn chỗ cho text).
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: `Write a short title (max 6 words, no quotes) for a conversation that starts with the message below. Reply in the SAME language as the message. Reply with the title only, nothing else.\n\nMessage:\n${firstMessage}`,
        },
      ],
    });
    const text = response.content
      .find(block => block.type === 'text')
      ?.text?.trim();
    if (text) {
      await this.conversationModel.updateOne(
        { _id: conversationId },
        { title: text },
      );
    }
  }

  async listConversations(
    userId: string,
    query: QueryPagination,
  ): Promise<TableResponse<AiConversationListItem>> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(50, Number(query.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const [total, docs] = await Promise.all([
      this.conversationModel.countDocuments({ userId }),
      this.conversationModel
        .find({ userId })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select('title createdAt updatedAt')
        .lean(),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPage: Math.max(1, Math.ceil(total / pageSize)),
      items: docs.map(doc => ({
        id: String(doc._id),
        title: doc.title,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })),
    };
  }

  async getConversation(
    id: string,
    userId: string,
  ): Promise<AiConversationDetail> {
    const doc = await this.conversationModel
      .findOne({ _id: id, userId })
      .lean();
    if (!doc) throw new NotFoundException('Không tìm thấy hội thoại');

    return {
      id: String(doc._id),
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      messages: this.toDisplayMessages(doc.messages),
    };
  }

  // Ẩn các message tool_result và gộp các lượt assistant liên tiếp (của cùng
  // một câu hỏi có tool use) thành một bong bóng chat.
  private toDisplayMessages(
    messages: AiMessage[],
  ): AiConversationDetail['messages'] {
    const out: AiConversationDetail['messages'] = [];
    for (const m of messages) {
      if (m.role === 'user' && Array.isArray(m.content)) continue;
      const last = out[out.length - 1];
      if (m.role === 'assistant' && last?.role === 'assistant') {
        last.text = [last.text, m.displayText].filter(Boolean).join('\n\n');
        last.cards.push(...(m.cards ?? []));
        continue;
      }
      out.push({
        role: m.role,
        text: m.displayText,
        cards: [...(m.cards ?? [])],
        createdAt: m.createdAt,
      });
    }
    return out;
  }

  async deleteConversation(
    id: string,
    userId: string,
  ): Promise<{ success: true }> {
    const result = await this.conversationModel.deleteOne({
      _id: id,
      userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Không tìm thấy hội thoại');
    }
    return { success: true };
  }
}
