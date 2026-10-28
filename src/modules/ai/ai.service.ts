import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';
import { Model } from 'mongoose';
import {
  AiConversation,
  AiConversationDocument,
} from 'src/schemas/ai-conversation.schema';
import { TableResponse } from 'src/types/response';
import { QueryPagination } from 'src/types/query';
import { ANTHROPIC_CLIENT } from './ai.constants';
import { ChatDto } from './dto/chat.dto';
import { CHAT_SYSTEM_PROMPT } from './prompts/system';

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
    createdAt: Date;
  }>;
}

@Injectable()
export class AiService {
  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly anthropic: Anthropic | null,
    private readonly configService: ConfigService,
    @InjectModel(AiConversation.name)
    private readonly conversationModel: Model<AiConversationDocument>,
  ) {}

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

  // SSE: meta (conversationId) -> thinking*/text* -> done (usage) | error.
  // `tool`/`card` sẽ được Phase 2/3 phát thêm vào cùng stream này.
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

    const history = conversation.messages.map(m => ({
      role: m.role,
      content: m.content,
    })) as Anthropic.MessageParam[];

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

    const stream = this.anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: CHAT_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort },
      messages: [...history, { role: 'user', content: userContent }],
    });

    const onClientClose = () => stream.abort();
    req.on('close', onClientClose);

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            writeEvent('text', { text: event.delta.text });
          } else if (event.delta.type === 'thinking_delta') {
            writeEvent('thinking', { text: event.delta.thinking });
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason === 'refusal') {
        writeEvent('error', {
          message: 'Claude đã từ chối trả lời câu này.',
          category: finalMessage.stop_details?.category ?? null,
        });
        writeEvent('done', { usage: finalMessage.usage });
        return;
      }

      conversation.messages.push({
        role: 'user',
        content: userContent,
        displayText: dto.message,
        createdAt: new Date(),
      });
      conversation.messages.push({
        role: 'assistant',
        content: finalMessage.content,
        displayText: finalMessage.content
          .filter(
            (block): block is Anthropic.TextBlock => block.type === 'text',
          )
          .map(block => block.text)
          .join('\n'),
        createdAt: new Date(),
      });
      await conversation.save();

      if (finalMessage.stop_reason === 'max_tokens') {
        writeEvent('error', {
          message: 'Phản hồi bị cắt do quá dài (max_tokens).',
        });
      }

      if (!conversation.title) {
        this.generateTitle(String(conversation._id), dto.message).catch(
          (err: unknown) => console.error('generateTitle failed:', err),
        );
      }

      writeEvent('done', { usage: finalMessage.usage });
    } catch (error) {
      writeEvent('error', { message: this.describeStreamError(error) });
    } finally {
      req.off('close', onClientClose);
      res.end();
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
      messages: doc.messages.map(m => ({
        role: m.role,
        text: m.displayText,
        createdAt: m.createdAt,
      })),
    };
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
