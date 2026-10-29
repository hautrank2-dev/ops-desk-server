import { z } from 'zod';
import { UserRoles } from 'src/schemas/user.schema';
import { escapeRegex } from 'src/utils/query';
import { nullableEnum } from './shared';
import { AiTool } from './types';

const input = z.object({
  search: z.string().nullable(),
  role: z.enum(['admin', 'manager', 'user']).nullable(),
});

export const searchUsersTool: AiTool<typeof input> = {
  input,
  definition: {
    name: 'search_users',
    description:
      'Find active users by name / username / email (partial match) and optional role. Use it to resolve a person name to a user id before filtering tickets by assignee.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['search', 'role'],
      properties: {
        search: { type: ['string', 'null'] },
        role: nullableEnum(UserRoles),
      },
    } as never,
  },
  async run({ search, role }, { userModel }) {
    const filter: Record<string, unknown> = { status: 'active' };
    if (role) filter.role = role;
    if (search) {
      const re = { $regex: escapeRegex(search), $options: 'i' };
      filter.$or = [{ name: re }, { username: re }, { email: re }];
    }
    const users = await userModel
      .find(filter)
      .select('name username role')
      .limit(20)
      .lean();
    return users.map(u => ({
      id: String(u._id),
      name: u.name,
      username: u.username,
      role: u.role,
    }));
  },
};
