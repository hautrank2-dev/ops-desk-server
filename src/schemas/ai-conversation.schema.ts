import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AiMessageRole = 'user' | 'assistant';

export interface AiCard {
  type: string;
  data: unknown;
}

@Schema({ _id: false })
export class AiMessage {
  @Prop({ type: String, required: true, enum: ['user', 'assistant'] })
  role: AiMessageRole;

  // Raw Anthropic content blocks actually sent/received — kept as-is so the
  // conversation can be replayed to the API on the next turn (including
  // thinking / tool_use / tool_result from Phase 2+).
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content: unknown;

  // Clean text for the client to render, without parsing Anthropic blocks.
  // Not `required`: Mongoose treats '' as missing, and tool_result turns /
  // tool_use-only assistant turns both have an empty displayText.
  @Prop({ type: String, default: '' })
  displayText: string;

  // Structured output (e.g. TicketRankingCard) emitted in this turn, so the
  // client can re-render it when the conversation is reopened.
  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  cards?: AiCard[];

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const AiMessageSchema = SchemaFactory.createForClass(AiMessage);

export type AiConversationDocument = AiConversation & Document;

@Schema({ timestamps: true })
export class AiConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  title: string | null;

  @Prop({ type: [AiMessageSchema], default: [] })
  messages: AiMessage[];

  // Managed by `timestamps: true` on @Schema — redeclared here (without
  // @Prop) only so TypeScript knows these fields exist on the document.
  createdAt: Date;
  updatedAt: Date;
}

export const AiConversationSchema =
  SchemaFactory.createForClass(AiConversation);
