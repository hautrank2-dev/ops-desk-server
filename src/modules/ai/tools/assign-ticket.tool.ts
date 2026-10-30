import { Types } from 'mongoose';
import { z } from 'zod';
import { TicketStatus } from 'src/schemas/ticket.schema';
import { escapeRegex } from 'src/utils/query';
import { AiTool } from './types';

const MAX_CANDIDATES = 30;

const input = z.object({
  code: z.string(),
  assignee: z.string(),
});

// Tool ghi duy nhất: gán người xử lý cho ticket. Nếu tên khớp nhiều user thì
// KHÔNG ghi gì, trả về danh sách để model hỏi lại end user chọn.
// `assignee` là một string (id hoặc tên) thay vì 2 field nullable: strict tool
// schema giới hạn tổng 16 param kiểu union trên toàn bộ tools.
export const assignTicketTool: AiTool<typeof input> = {
  input,
  definition: {
    name: 'assign_ticket',
    description:
      'Assign a ticket (by code, e.g. OPS-000123) to a user. `assignee` is either the user id (when known, e.g. after the user picked from candidates) or a name / username / email (partial match). If the name matches several users nothing is changed and status "ambiguous" is returned with candidates — ask the user to choose, then call again with the chosen user id as assignee.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'assignee'],
      properties: {
        code: { type: 'string' },
        assignee: { type: 'string', description: 'User id or name.' },
      },
    } as never,
  },
  async run({ code, assignee }, { ticketModel, userModel, userId }) {
    if (!userId) throw new Error('Missing current user');

    const ticket = await ticketModel
      .findOne({
        code: { $regex: `^${escapeRegex(code.trim())}$`, $options: 'i' },
      })
      .select('code title status assigneeId');
    if (!ticket)
      return { status: 'not_found', message: `Ticket ${code} not found` };

    const assigneeName = assignee.trim();
    let users;
    if (Types.ObjectId.isValid(assigneeName)) {
      users = await userModel
        .find({ _id: assigneeName, status: 'active' })
        .select('name username email role')
        .lean();
    } else if (assigneeName) {
      const re = { $regex: escapeRegex(assigneeName), $options: 'i' };
      users = await userModel
        .find({
          status: 'active',
          $or: [{ name: re }, { username: re }, { email: re }],
        })
        .select('name username email role')
        .limit(MAX_CANDIDATES + 1)
        .lean();
      // Ưu tiên khớp chính xác tên/username nếu chỉ có đúng một người.
      const exact = users.filter(
        u =>
          u.name?.toLowerCase() === assigneeName.toLowerCase() ||
          u.username?.toLowerCase() === assigneeName.toLowerCase(),
      );
      if (exact.length === 1 && users.length > 1) {
        const others = users.filter(u => u !== exact[0]);
        // Vẫn hỏi lại nếu có người khác trùng đúng tên hiển thị.
        if (!others.some(u => u.name === exact[0].name)) users = exact;
      }
    } else {
      throw new Error('assignee is required');
    }

    const candidates = users.map(u => ({
      id: String(u._id),
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
    }));
    if (candidates.length === 0) {
      return { status: 'user_not_found', message: 'No active user matches' };
    }
    if (candidates.length > 1) {
      // Quá nhiều người khớp → yêu cầu tên cụ thể hơn thay vì liệt kê thiếu.
      if (candidates.length > MAX_CANDIDATES) {
        return {
          status: 'too_many_matches',
          message: `More than ${MAX_CANDIDATES} users match; ask for a more specific name, username or email`,
        };
      }
      return {
        status: 'ambiguous',
        ticket: ticket.code,
        total: candidates.length,
        candidates,
      };
    }

    const target = candidates[0];
    const previousAssigneeId = ticket.assigneeId ?? null;
    ticket.assigneeId = target.id;
    if (ticket.status === TicketStatus.New)
      ticket.status = TicketStatus.Assigned;
    ticket.updatedBy = new Types.ObjectId(userId);
    await ticket.save();

    return {
      status: 'assigned',
      ticket: { code: ticket.code, title: ticket.title, status: ticket.status },
      assignee: target,
      previousAssigneeId,
    };
  },
};
