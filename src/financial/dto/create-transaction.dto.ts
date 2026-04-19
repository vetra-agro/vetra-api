import { IsString, IsNumber, IsEnum, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ example: 'Venda de Soja' })
  @IsString()
  description: string;

  @ApiProperty({ example: 15000.00 })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: '2024-06-01' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: 'Venda' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  field_id?: string;
}
