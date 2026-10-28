import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  TicketPriority,
  TicketStatus,
  TicketType,
} from 'src/schemas/ticket.schema';
import { QueryPagination } from 'src/types/query';
import { ToArrayQuery, ToStringArrayQuery } from 'src/utils/transform';

export enum TicketPopulationEnum {
  CreatedBy = 'createdBy',
  UpdatedBy = 'updatedBy',
  AssigneeId = 'assigneeId',
  assetItemId = 'assetItemId',
}

// Narrows the base `populations` (QueryInclude) to this module's enum.
export class TicketQueryDto extends QueryPagination {
  @ApiPropertyOptional({
    description: 'Search by code (partial match)',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: 'Search by title (partial match)',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: TicketType })
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({
    description: 'Asset item ids',
    isArray: true,
    type: [String],
  })
  @IsOptional()
  @ToArrayQuery()
  @IsArray()
  @IsMongoId()
  assetItemIds?: string[];

  @ApiPropertyOptional({
    description: 'Location id',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Assignee id',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Department id',
  })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({
    description:
      'Due date range start (ISO), example: 2026-02-28T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  startDueAt?: string;

  @ApiPropertyOptional({
    description: 'Due date range end (ISO), example: 2026-02-28T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endDueAt?: string;

  @ApiPropertyOptional({
    description:
      'Created date range start (ISO), example: 2026-02-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startCreatedAt?: string;

  @ApiPropertyOptional({
    description:
      'Created date range end (ISO), example: 2026-02-28T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endCreatedAt?: string;

  @ApiPropertyOptional({
    description: 'User id',
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  // sort
  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'createdAt',
    enum: ['createdAt', 'updatedAt', 'dueAt', 'priority', 'status'],
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'The field for Population',
    isArray: true,
    enum: TicketPopulationEnum,
  })
  @IsOptional()
  @ToStringArrayQuery()
  @IsArray()
  @IsEnum(TicketPopulationEnum, { each: true })
  populations?: TicketPopulationEnum[];
}

export class TicketDetailQueryDto extends QueryPagination {
  @ApiPropertyOptional({
    description: 'The field for Population',
    isArray: true,
    enum: TicketPopulationEnum,
  })
  @IsOptional()
  @ToStringArrayQuery()
  @IsArray()
  @IsEnum(TicketPopulationEnum, { each: true })
  populations?: TicketPopulationEnum[];
}
