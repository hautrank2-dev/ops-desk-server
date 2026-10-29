import { QueryFilter } from 'mongoose';
import { z } from 'zod';
import {
  Ticket,
  TicketPriority,
  TicketStatus,
  TicketType,
} from 'src/schemas/ticket.schema';
import { escapeRegex } from 'src/utils/query';
import { AiTool } from './types';
import {
  daysBetween,
  nullableEnum,
  nullableEnumArray,
  OPEN_STATUSES,
} from './shared';

const PRIORITY_RANK = Object.values(TicketPriority);

const input = z.object({
  status: z.array(z.enum(TicketStatus)).nullable(),
  priority: z.array(z.enum(TicketPriority)).nullable(),
  type: z.array(z.enum(TicketType)).nullable(),
  assigneeId: z.string().nullable(),
  unassigned: z.boolean().nullable(),
  overdue: z.boolean().nullable(),
  dueBefore: z.string().nullable(),
  dueAfter: z.string().nullable(),
  text: z.string().nullable(),
  sortBy: z.enum(['priority', 'dueAt', 'createdAt', 'updatedAt']).nullable(),
  limit: z.number().int().nullable(),
});

export const searchTicketsTool: AiTool<typeof input> = {
  input,
  definition: {
    name: 'search_tickets',
    description:
      'Search tickets with filters. Returns compact rows (code, title, type, priority, status, dueAt, assignee, comment count, days open, days overdue, days since last update). Pass null for any filter you do not need. Defaults: status = open statuses (New, Assigned, Doing, Waiting), sortBy = priority, limit = 20 (max 50).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(input.shape),
      properties: {
        status: nullableEnumArray(
          Object.values(TicketStatus),
          'Statuses to include.',
        ),
        priority: nullableEnumArray(
          Object.values(TicketPriority),
          'Priorities.',
        ),
        type: nullableEnumArray(Object.values(TicketType), 'Ticket types.'),
        assigneeId: { type: ['string', 'null'], description: 'User id.' },
        unassigned: {
          type: ['boolean', 'null'],
          description: 'true = only tickets without assignee.',
        },
        overdue: {
          type: ['boolean', 'null'],
          description: 'true = only open tickets whose dueAt has passed.',
        },
        dueBefore: { type: ['string', 'null'], description: 'ISO date.' },
        dueAfter: { type: ['string', 'null'], description: 'ISO date.' },
        text: {
          type: ['string', 'null'],
          description: 'Partial match on code or title.',
        },
        sortBy: nullableEnum(['priority', 'dueAt', 'createdAt', 'updatedAt']),
        limit: { type: ['integer', 'null'], description: '1–50.' },
      },
    } as never,
  },
  async run(args, { ticketModel, commentModel }) {
    const now = new Date();
    const filter: QueryFilter<Ticket> = {
      status: { $in: args.status?.length ? args.status : OPEN_STATUSES },
    };
    if (args.priority?.length) filter.priority = { $in: args.priority };
    if (args.type?.length) filter.type = { $in: args.type };
    if (args.assigneeId) filter.assigneeId = args.assigneeId;
    if (args.unassigned) filter.assigneeId = { $in: [null, ''] };

    const dueAt: { $lt?: Date; $lte?: Date; $gte?: Date } = {};
    if (args.overdue) dueAt.$lt = now;
    if (args.dueBefore) dueAt.$lte = new Date(args.dueBefore);
    if (args.dueAfter) dueAt.$gte = new Date(args.dueAfter);
    if (Object.keys(dueAt).length) filter.dueAt = dueAt;

    if (args.text) {
      const re = { $regex: escapeRegex(args.text), $options: 'i' };
      filter.$or = [{ code: re }, { title: re }];
    }

    const limit = Math.max(1, Math.min(50, args.limit ?? 20));
    const sortBy = args.sortBy ?? 'priority';
    const match = ticketModel.find().cast(ticketModel, filter);

    const [total, docs] = await Promise.all([
      ticketModel.countDocuments(filter),
      ticketModel.aggregate<
        Ticket & { _id: unknown; updatedAt: Date; createdAt: Date }
      >([
        { $match: match },
        {
          $addFields: {
            _rank: { $indexOfArray: [PRIORITY_RANK, '$priority'] },
          },
        },
        {
          $sort:
            sortBy === 'priority'
              ? { _rank: -1, dueAt: 1 }
              : sortBy === 'dueAt'
                ? { dueAt: 1 }
                : { [sortBy]: -1 },
        },
        { $limit: limit },
        { $project: { _rank: 0, description: 0, imageUrls: 0 } },
      ]),
    ]);
    await ticketModel.populate(docs, { path: 'assigneeId', select: 'name' });

    const counts = await commentModel.aggregate<{ _id: unknown; n: number }>([
      {
        $match: {
          ticketId: { $in: docs.map(d => d._id) },
          isDeleted: false,
        },
      },
      { $group: { _id: '$ticketId', n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map(c => [String(c._id), c.n]));

    return {
      total,
      returned: docs.length,
      items: docs.map(t => {
        const assignee = t.assigneeId as unknown as { name?: string } | null;
        const overdueDays =
          t.dueAt && t.dueAt < now ? daysBetween(t.dueAt, now) : null;
        return {
          id: String(t._id),
          code: t.code,
          title: t.title,
          type: t.type,
          priority: t.priority,
          status: t.status,
          dueAt: t.dueAt ?? null,
          overdueDays,
          assignee: assignee?.name ?? null,
          comments: countMap.get(String(t._id)) ?? 0,
          daysOpen: daysBetween(t.createdAt, now),
          daysSinceUpdate: daysBetween(t.updatedAt, now),
        };
      }),
    };
  },
};
