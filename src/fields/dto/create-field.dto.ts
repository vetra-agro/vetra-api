import { IsString, IsUUID, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFieldDto {
  @ApiProperty()
  @IsUUID()
  farm_id: string;

  @ApiProperty({ example: 'Talhão A' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Soja' })
  @IsOptional()
  @IsString()
  crop?: string;

  @ApiPropertyOptional({ example: 240.5 })
  @IsOptional()
  @IsNumber()
  area_ha?: number;

  @ApiPropertyOptional({ description: 'GeoJSON Polygon do talhão' })
  @IsOptional()
  @IsObject()
  geometry?: Record<string, any>;

  @ApiPropertyOptional({ example: '2024-10', description: 'Safra atual ex: 2024-10' })
  @IsOptional()
  @IsString()
  current_season?: string;
}
