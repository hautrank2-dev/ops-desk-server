import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, UserRoles, UserStatus } from 'src/schemas/user.schema';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  username!: string;

  @IsEmail()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => String(value).trim())
  name!: string;

  @IsIn(UserRoles)
  role!: UserRole;

  @IsOptional()
  @IsMongoId()
  deptId?: string;

  @IsOptional()
  @IsIn(['active', 'blocked'])
  status?: UserStatus;
}
