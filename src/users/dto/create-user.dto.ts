import {
  IsEmail, IsString, IsEnum, IsOptional,
  MinLength, IsArray, IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UserRole {
  OWNER      = 'owner',
  MANAGER    = 'manager',
  AGRONOMIST = 'agronomist',
  ACCOUNTANT = 'accountant',
  OPERATOR   = 'operator',
  VIEWER     = 'viewer',
}

export class CreateUserDto {
  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'joao@fazenda.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Senha@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole, default: UserRole.VIEWER })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ example: '65999998888' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  farmIds?: string[];
}
