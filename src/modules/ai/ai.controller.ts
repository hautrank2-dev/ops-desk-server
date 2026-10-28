import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ValidTokenGuard } from 'src/guards/valid-token.guard';
import { QueryPagination } from 'src/types/query';
import { AiHealth, AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('health')
  checkHealth(): Promise<AiHealth> {
    return this.aiService.checkHealth();
  }

  // SSE qua POST (không dùng EventSource vì nó không gửi được body POST) —
  // client dùng fetch + ReadableStream để đọc stream này.
  @Post('chat')
  @UseGuards(ValidTokenGuard)
  async chat(
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = this.requireUserId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    await this.aiService.streamChat(userId, dto, req, res);
  }

  @Get('conversations')
  @UseGuards(ValidTokenGuard)
  listConversations(@Query() query: QueryPagination, @Req() req: Request) {
    const userId = this.requireUserId(req);
    return this.aiService.listConversations(userId, query);
  }

  @Get('conversations/:id')
  @UseGuards(ValidTokenGuard)
  getConversation(@Param('id') id: string, @Req() req: Request) {
    const userId = this.requireUserId(req);
    return this.aiService.getConversation(id, userId);
  }

  @Delete('conversations/:id')
  @UseGuards(ValidTokenGuard)
  deleteConversation(@Param('id') id: string, @Req() req: Request) {
    const userId = this.requireUserId(req);
    return this.aiService.deleteConversation(id, userId);
  }

  private requireUserId(req: Request): string {
    if (!req.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return req.payload.userId;
  }
}
