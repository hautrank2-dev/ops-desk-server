import type Anthropic from '@anthropic-ai/sdk';
import type { Model } from 'mongoose';
import type { z } from 'zod';
import type { Ticket } from 'src/schemas/ticket.schema';
import type { TicketComment } from 'src/schemas/ticket-comment.schema';
import type { User } from 'src/schemas/user.schema';

export interface AiToolDeps {
  ticketModel: Model<Ticket>;
  commentModel: Model<TicketComment>;
  userModel: Model<User>;
}

// Mỗi tool = schema gửi cho Claude + zod validate input + handler chỉ đọc.
// `card` = tool chỉ dùng để trả structured output cho client (không đọc DB).
export interface AiTool<S extends z.ZodType = z.ZodType> {
  definition: Anthropic.Tool;
  input: S;
  card?: string;
  run: (input: z.infer<S>, deps: AiToolDeps) => Promise<unknown>;
}
