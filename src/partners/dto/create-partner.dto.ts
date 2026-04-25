import {
  IsString, IsEnum, IsArray, IsOptional,
  IsEmail, IsNumber, IsUUID, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PartnerType {
  CLIENT       = 'client',
  SUPPLIER     = 'supplier',
  CARRIER      = 'carrier',
  SHARECROPPER = 'sharecropper',
  COOPERATIVE  = 'cooperative',
  TRADING      = 'trading',
  BROKER       = 'broker',
  WAREHOUSE    = 'warehouse',
  SERVICE      = 'service',
  FINANCIAL    = 'financial',
}

export enum PersonType { LEGAL = 'legal', NATURAL = 'natural' }

export class CreatePartnerDto {
  @ApiProperty({ enum: PartnerType, isArray: true, example: ['client','supplier'] })
  @IsArray() @IsEnum(PartnerType, { each: true })
  types: PartnerType[];

  @ApiProperty({ enum: PersonType, default: PersonType.LEGAL })
  @IsEnum(PersonType)
  personType: PersonType;

  @ApiProperty({ example: 'Cooperativa Agrícola Centro-Oeste Ltda' })
  @IsString() @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ example: 'CoopCentro' })
  @IsOptional() @IsString() tradeName?: string;

  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  @IsOptional() @IsString() document?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() stateReg?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()  email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() neighborhood?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankAgency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankPixKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() anttCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray()  vehicleTypes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray()  farmIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() sharecropPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() bankCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() swiftCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray()  tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID()   tenantId?: string;
}
