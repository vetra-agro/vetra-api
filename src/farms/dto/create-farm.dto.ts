import { IsString, IsOptional, IsNumber, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFarmDto {
  @ApiProperty({ example: 'Fazenda Santa Fé' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Sorriso, MT' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'MT' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 1500.5, description: 'Área total em hectares' })
  @IsOptional()
  @IsNumber()
  total_area_ha?: number;

  @ApiPropertyOptional({ example: 'Produção de soja e milho' })
  @IsOptional()
  @IsString()
  description?: string;
}
