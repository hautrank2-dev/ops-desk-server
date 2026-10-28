import { Type } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ChatContextDto {
  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsMongoId()
  ticketId?: string;
}

export class ChatDto {
  @IsOptional()
  @IsMongoId()
  conversationId?: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
