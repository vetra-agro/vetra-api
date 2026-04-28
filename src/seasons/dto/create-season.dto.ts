import {
  IsString, IsEnum, IsNumber, IsArray,
  IsOptional, IsUUID, IsDateString, Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum SeasonStatus {
  PLANNING   = "planning",
  PLANTING   = "planting",
  GROWING    = "growing",
  HARVESTING = "harvesting",
  FINISHED   = "finished",
  CANCELLED  = "cancelled",
}
export enum SeasonType {
  SUMMER    = "summer",
  WINTER    = "winter",
  THIRD     = "third",
  PERENNIAL = "perennial",
  OTHER     = "other",
}

export class CreateSeasonDto {
  @ApiProperty() @IsUUID() tenantId: string;
  @ApiProperty() @IsUUID() farmId:   string;
  @ApiProperty() @IsString() name:   string;
  @ApiProperty() @IsString() crop:   string;

  @ApiPropertyOptional() @IsOptional() @IsString()           code?:     string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(SeasonType)   type?:     SeasonType;
  @ApiPropertyOptional() @IsOptional() @IsEnum(SeasonStatus) status?:   SeasonStatus;
  @ApiPropertyOptional() @IsOptional() @IsString()           variety?:  string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()       plantingStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()       plantingEnd?:   string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()       harvestStart?:  string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()       harvestEnd?:    string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           cycleDays?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)   totalAreaHa?:   number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           plantedAreaHa?:    number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           harvestedAreaHa?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           expectedYieldScHa?:   number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           actualYieldScHa?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           expectedProductionSc?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           actualProductionSc?:  number;
  @ApiPropertyOptional() @IsOptional() @IsString()           unit?:     string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           expectedRevenue?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           actualRevenue?:    number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           expectedCostHa?:   number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           actualCostHa?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           pricePerUnit?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           rainfallMm?:       number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()           avgTempC?:         number;
  @ApiPropertyOptional() @IsOptional() @IsArray()            fieldIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString()           notes?:    string;
  @ApiPropertyOptional() @IsOptional() @IsArray()            tags?:     string[];
}
