import { getTicketStatsTool } from './get-ticket-stats.tool';
import { getTicketTool } from './get-ticket.tool';
import { presentRankingTool } from './present-ranking.tool';
import { searchTicketsTool } from './search-tickets.tool';
import { searchUsersTool } from './search-users.tool';
import { AiTool } from './types';

export const AI_TOOLS = [
  searchTicketsTool,
  getTicketTool,
  getTicketStatsTool,
  searchUsersTool,
  presentRankingTool,
] as AiTool[];

export const AI_TOOL_MAP = new Map(AI_TOOLS.map(t => [t.definition.name, t]));

export * from './types';
