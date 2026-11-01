import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, UserRoles } from 'src/schemas/user.schema';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  email?: string;

  // Cho phép đổi password (optional)
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => String(value).trim())
  name?: string;

  @IsOptional()
  @IsIn(UserRoles)
  role?: UserRole;

  // Cho phép set/unset deptId: gửi null để unset (tuỳ cách bạn xử lý ở service)
  @IsOptional()
  @IsMongoId()
  deptId?: string;

  @IsOptional()
  @IsIn(['active', 'blocked'])
  status?: 'active' | 'blocked';
}
