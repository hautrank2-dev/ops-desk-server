import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { Item } from './item.schema';

export type TicketDocument = Ticket & Document;

export enum TicketType {
  Repair = 'Repair',
  Maintenance = 'Maintenance',
  Request = 'Request',
  Incident = 'Incident',
}

export enum TicketPriority {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  Urgent = 'Urgent',
}

export enum TicketStatus {
  New = 'New',
  Assigned = 'Assigned',
  Doing = 'Doing',
  Waiting = 'Waiting',
  Done = 'Done',
  Cancelled = 'Cancelled',
}

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ required: true, unique: true })
  code: string; // OPS-000456

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true, enum: TicketType })
  type: TicketType;

  @Prop({
    required: true,
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: Item.name }],
    validate: [
      (v: Types.ObjectId[]) => Array.isArray(v) && v.length > 0,
      'assetItemIds must not be empty',
    ],
  })
  assetItemIds: Types.ObjectId[];

  @Prop({ enum: TicketPriority, default: TicketPriority.Medium })
  priority: TicketPriority;

  @Prop({ enum: TicketStatus, default: TicketStatus.New })
  status: TicketStatus;

  @Prop()
  cause?: string;

  @Prop()
  note?: string;

  @Prop()
  locationId?: string;

  // Stored as a string id; `ref` lets it be populated as a User.
  @Prop({ type: String, ref: User.name })
  assigneeId?: string;

  @Prop()
  teamId?: string;

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop()
  dueAt?: Date;

  @Prop()
  closedAt?: Date;

  @Prop({
    required: true,
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
  })
  createdBy: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: User.name, default: null })
  updatedBy?: Types.ObjectId;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
