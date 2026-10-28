import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AiMessageRole = 'user' | 'assistant';

@Schema({ _id: false })
export class AiMessage {
  @Prop({ type: String, required: true, enum: ['user', 'assistant'] })
  role: AiMessageRole;

  // Raw Anthropic content blocks actually sent/received — kept as-is so the
  // conversation can be replayed to the API on the next turn (kể cả
  // thinking / tool_use / tool_result khi có ở Phase 2+).
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content: unknown;

  // Clean text for the client to render, without parsing Anthropic blocks.
  @Prop({ required: true })
  displayText: string;

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

  // Quản lý tự động bởi `timestamps: true` ở @Schema — khai báo lại ở đây
  // (không gắn @Prop) chỉ để TypeScript biết field tồn tại trên document.
  createdAt: Date;
  updatedAt: Date;
}

export const AiConversationSchema =
  SchemaFactory.createForClass(AiConversation);
