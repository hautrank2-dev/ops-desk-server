import { TicketStatus } from 'src/schemas/ticket.schema';

export const OPEN_STATUSES = [
  TicketStatus.New,
  TicketStatus.Assigned,
  TicketStatus.Doing,
  TicketStatus.Waiting,
];

// Strict tool schema không cho `enum` đi cùng `type: [..., 'null']` — enum
// nullable phải viết bằng anyOf.
export const nullableEnum = (values: string[], description?: string) => ({
  anyOf: [{ type: 'string', enum: values }, { type: 'null' }],
  ...(description ? { description } : {}),
});

export const nullableEnumArray = (values: string[], description?: string) => ({
  anyOf: [
    { type: 'array', items: { type: 'string', enum: values } },
    { type: 'null' },
  ],
  ...(description ? { description } : {}),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysBetween = (from: Date | undefined, to = new Date()) =>
  from ? Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS) : null;
