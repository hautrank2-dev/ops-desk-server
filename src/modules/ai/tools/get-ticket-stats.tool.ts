import { z } from 'zod';
import { AiTool } from './types';
import { OPEN_STATUSES } from './shared';

const GROUP_FIELDS = {
  status: '$status',
  priority: '$priority',
  type: '$type',
  assignee: '$assigneeId',
} as const;

const input = z.object({
  groupBy: z.enum(['status', 'priority', 'type', 'assignee']),
  onlyOpen: z.boolean(),
});

export const getTicketStatsTool: AiTool<typeof input> = {
  input,
  definition: {
    name: 'get_ticket_stats',
    description:
      'Count tickets grouped by status, priority, type or assignee. Each group also reports how many are overdue. onlyOpen = only New/Assigned/Doing/Waiting.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['groupBy', 'onlyOpen'],
      properties: {
        groupBy: {
          type: 'string',
          enum: ['status', 'priority', 'type', 'assignee'],
        },
        onlyOpen: { type: 'boolean' },
      },
    } as never,
  },
  async run({ groupBy, onlyOpen }, { ticketModel, userModel }) {
    const now = new Date();
    const rows = await ticketModel.aggregate<{
      _id: string | null;
      count: number;
      overdue: number;
    }>([
      ...(onlyOpen ? [{ $match: { status: { $in: OPEN_STATUSES } } }] : []),
      {
        $group: {
          _id: GROUP_FIELDS[groupBy],
          count: { $sum: 1 },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$dueAt', now] },
                    { $gt: ['$dueAt', null] },
                    { $in: ['$status', OPEN_STATUSES] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    let names = new Map<string, string>();
    if (groupBy === 'assignee') {
      const users = await userModel
        .find({ _id: { $in: rows.map(r => r._id).filter(Boolean) } })
        .select('name')
        .lean();
      names = new Map(users.map(u => [String(u._id), u.name]));
    }

    return {
      groupBy,
      onlyOpen,
      groups: rows.map(r => ({
        key:
          groupBy === 'assignee'
            ? r._id
              ? (names.get(String(r._id)) ?? String(r._id))
              : 'Unassigned'
            : r._id,
        ...(groupBy === 'assignee' && r._id ? { userId: String(r._id) } : {}),
        count: r.count,
        overdue: r.overdue,
      })),
    };
  },
};
