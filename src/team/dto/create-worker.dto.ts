import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WorkerRole {
  MANAGER = 'manager',
  OPERATOR = 'operator',
  FIELD = 'field',
  DRIVER = 'driver',
}

export class CreateWorkerDto {
  @ApiProperty({ example: 'José Pereira' })
  @IsString()
  name: string;

  @ApiProperty({ enum: WorkerRole })
  @IsEnum(WorkerRole)
  role: WorkerRole;

  @ApiPropertyOptional({ example: 2500.00 })
  @IsOptional()
  @IsNumber()
  monthly_wage?: number;

  @ApiPropertyOptional({ example: '11999999999' })
  @IsOptional()
  @IsString()
  phone?: string;
}
