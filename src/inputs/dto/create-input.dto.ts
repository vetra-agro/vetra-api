import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InputCategory {
  SEED = 'seed',
  PESTICIDE = 'pesticide',
  FERTILIZER = 'fertilizer',
  FUEL = 'fuel',
  OTHER = 'other',
}

export class CreateInputDto {
  @ApiProperty({ example: 'Roundup' })
  @IsString()
  name: string;

  @ApiProperty({ enum: InputCategory })
  @IsEnum(InputCategory)
  category: InputCategory;

  @ApiProperty({ example: 'L', description: 'Unidade de medida' })
  @IsString()
  unit: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ example: 50, description: 'Estoque mínimo para alerta' })
  @IsOptional()
  @IsNumber()
  min_quantity?: number;

  @ApiPropertyOptional({ example: 45.90 })
  @IsOptional()
  @IsNumber()
  unit_cost?: number;
}
