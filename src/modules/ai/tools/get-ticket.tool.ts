import { Types } from 'mongoose';
import { z } from 'zod';
import { Ticket } from 'src/schemas/ticket.schema';
import { TicketComment } from 'src/schemas/ticket-comment.schema';
import { AiTool } from './types';
import { daysBetween } from './shared';

const input = z.object({
  ticketId: z.string().nullable(),
  code: z.string().nullable(),
});

type Named = { name?: string } | null;

type LeanTicket = Omit<Ticket, 'assigneeId' | 'createdBy'> & {
  _id: Types.ObjectId;
  assigneeId: Named;
  createdBy: Named;
  createdAt: Date;
  updatedAt: Date;
};

type LeanComment = Omit<TicketComment, 'createdBy'> & {
  createdBy: Named;
  createdAt: Date;
};

export const getTicketTool: AiTool<typeof input> = {
  input,
  definition: {
    name: 'get_ticket',
    description:
      'Get full detail of one ticket by id or by code (e.g. OPS-000123): description, cause, note, asset items, image count, and the comment thread in chronological order.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ticketId', 'code'],
      properties: {
        ticketId: { type: ['string', 'null'] },
        code: { type: ['string', 'null'] },
      },
    } as never,
  },
  async run({ ticketId, code }, { ticketModel, commentModel }) {
    const filter =
      ticketId && Types.ObjectId.isValid(ticketId)
        ? { _id: ticketId }
        : code
          ? { code: code.trim().toUpperCase() }
          : null;
    if (!filter) return { error: 'Provide ticketId or code.' };

    const t = await ticketModel
      .findOne(filter)
      .populate([
        { path: 'assigneeId', select: 'name' },
        { path: 'createdBy', select: 'name' },
        { path: 'assetItemIds', select: 'code name serialNumber status' },
      ])
      .lean<LeanTicket>();
    if (!t) return { error: 'Ticket not found.' };

    const comments = await commentModel
      .find({ ticketId: t._id, isDeleted: false })
      .sort({ createdAt: 1 })
      .limit(40)
      .populate({ path: 'createdBy', select: 'name' })
      .lean<LeanComment[]>();

    return {
      id: String(t._id),
      code: t.code,
      title: t.title,
      description: t.description ?? null,
      type: t.type,
      priority: t.priority,
      status: t.status,
      cause: t.cause ?? null,
      note: t.note ?? null,
      assignee: t.assigneeId?.name ?? null,
      createdBy: t.createdBy?.name ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      dueAt: t.dueAt ?? null,
      closedAt: t.closedAt ?? null,
      daysOpen: daysBetween(t.createdAt),
      imageCount: t.imageUrls?.length ?? 0,
      assetItems: t.assetItemIds ?? [],
      comments: comments.map(c => ({
        by: c.createdBy?.name ?? null,
        at: c.createdAt,
        depth: c.depth,
        content: c.content,
        images: c.imgUrls?.length ?? 0,
      })),
    };
  },
};
