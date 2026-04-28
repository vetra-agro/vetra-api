import {
  IsString,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  IsOptional,
  IsEmail,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FarmBiome {
  CERRADO = 'cerrado',
  AMAZONIA = 'amazonia',
  MATA_ATLANTICA = 'mata_atlantica',
  CAATINGA = 'caatinga',
  PAMPA = 'pampa',
  PANTANAL = 'pantanal',
}

export enum FarmStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SOLD = 'sold',
  LEASED = 'leased',
}

export class CreateFarmDto {
  @ApiProperty() @IsUUID() tenantId: string;
  @ApiProperty() @IsString() name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() tradeName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FarmStatus) status?: FarmStatus;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FarmBiome) biome?: FarmBiome;

  // Responsáveis
  @ApiPropertyOptional() @IsOptional() @IsString() ownerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() managerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() managerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() managerEmail?: string;

  // Localização
  @ApiProperty() @IsString() state: string;
  @ApiProperty() @IsString() city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zipCode?: string;

  // Geo
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() altitudeM?: number;
  @ApiPropertyOptional({ description: 'Array de [lng, lat] formando polígono' })
  @IsOptional()
  @IsArray()
  boundaryCoords?: [number, number][];

  // Área
  @ApiProperty() @IsNumber() @Min(0) totalAreaHa: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() usefulAreaHa?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() preservedAreaHa?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() irrigatedAreaHa?: number;

  // Documentação
  @ApiPropertyOptional() @IsOptional() @IsString() carNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() carStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() carAreaHa?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() itrNirf?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() itrAreaHa?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() registryNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() registryOffice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ccirNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() incraCode?: string;

  // Infraestrutura
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasElectricity?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasWaterSupply?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasInternet?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() internetType?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasStorage?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() storageCapacityTon?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasFuelStation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasWorkshop?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasHousing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() housingCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasScale?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() scaleCapacityTon?: number;

  // Produção
  @ApiPropertyOptional() @IsOptional() @IsArray() mainCrops?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() mainLivestock?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() certification?: string[];

  // Clima
  @ApiPropertyOptional() @IsOptional() @IsNumber() avgRainfallMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() avgTempC?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() frostRisk?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() tags?: string[];
}
