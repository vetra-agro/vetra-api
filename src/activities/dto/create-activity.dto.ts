import {
  IsString, IsEnum, IsNumber, IsArray,
  IsOptional, IsUUID, IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum ActivityType {
  PLANTING    = "planting",   SPRAYING    = "spraying",
  FERTILIZING = "fertilizing",HARVESTING  = "harvesting",
  SOIL_PREP   = "soil_prep",  IRRIGATION  = "irrigation",
  SCOUTING    = "scouting",   TRANSPORT   = "transport",
  MAINTENANCE = "maintenance",OTHER       = "other",
}
export enum ActivityStatus {
  PLANNED     = "planned",    IN_PROGRESS = "in_progress",
  DONE        = "done",       CANCELLED   = "cancelled",
}

export class CreateActivityDto {
  @ApiProperty() @IsUUID()                    tenantId:  string;
  @ApiProperty() @IsUUID()                    farmId:    string;
  @ApiProperty() @IsEnum(ActivityType)        type:      ActivityType;
  @ApiProperty() @IsDateString()              startedAt: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()              seasonId?:           string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(ActivityStatus) status?:            ActivityStatus;
  @ApiPropertyOptional() @IsOptional() @IsString()             name?:              string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()         finishedAt?:        string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             durationH?:         number;
  @ApiPropertyOptional() @IsOptional() @IsArray()              fieldIds?:          string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber()             areaHa?:            number;
  @ApiPropertyOptional() @IsOptional() @IsArray()              machineryIds?:      string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber()             hourmeterStart?:    number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             hourmeterEnd?:      number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             fuelUsedL?:         number;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               operatorId?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()             operatorName?:      string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              inputsApplied?:     any[];
  @ApiPropertyOptional() @IsOptional() @IsNumber()             productionSc?:      number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             productionTon?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             moisturePct?:       number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             impurityPct?:       number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             weatherTempC?:      number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             weatherWindKmh?:    number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             weatherHumidityPct?:number;
  @ApiPropertyOptional() @IsOptional() @IsString()             weatherCondition?:  string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             laborCost?:         number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             machineryCost?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             inputCost?:         number;
  @ApiPropertyOptional() @IsOptional() @IsString()             notes?:             string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              tags?:              string[];
}
