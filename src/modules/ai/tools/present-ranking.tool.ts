import { z } from 'zod';
import { AiTool } from './types';

const input = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      ticketId: z.string(),
      code: z.string(),
      title: z.string(),
      priority: z.string(),
      status: z.string(),
      score: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
});

export type TicketRankingCard = z.infer<typeof input>;

// Không đọc DB: model gọi tool này để giao danh sách xếp hạng dạng có cấu
// trúc; server phát sự kiện `card` cho client render TicketRankingCard.
export const presentRankingTool: AiTool<typeof input> = {
  input,
  card: 'ticket_ranking',
  definition: {
    name: 'present_ranking',
    description:
      'Show a ranked list of tickets to the user as an interactive card. Call it ONCE, after gathering data, whenever the answer is a ranking or prioritised list of tickets. Use only ticket ids returned by other tools. score is 0-100 (higher = harder and more urgent); reasons are 1-3 short phrases in the user language.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'items'],
      properties: {
        title: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'ticketId',
              'code',
              'title',
              'priority',
              'status',
              'score',
              'reasons',
            ],
            properties: {
              ticketId: { type: 'string' },
              code: { type: 'string' },
              title: { type: 'string' },
              priority: { type: 'string' },
              status: { type: 'string' },
              score: { type: 'integer' },
              reasons: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    } as never,
  },
  run: () => Promise.resolve({ shown: true }),
};
