import {
  IsString, IsEnum, IsNumber, IsBoolean, IsArray,
  IsOptional, IsUUID, IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum FieldNoteType {
  OBSERVATION    = "observation",    PEST           = "pest",
  DISEASE        = "disease",        WEED           = "weed",
  PHENOLOGY      = "phenology",      SOIL           = "soil",
  IRRIGATION_OBS = "irrigation",     RECOMMENDATION = "recommendation",
  SAMPLING       = "sampling",       OTHER          = "other",
}
export enum SeverityLevel {
  LOW      = "low",    MEDIUM   = "medium",
  HIGH     = "high",   CRITICAL = "critical",
}

export class CreateFieldNoteDto {
  @ApiProperty() @IsUUID()   tenantId: string;
  @ApiProperty() @IsUUID()   farmId:   string;
  @ApiProperty() @IsString() title:    string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()              fieldId?:          string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()              seasonId?:         string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FieldNoteType) type?:             FieldNoteType;
  @ApiPropertyOptional() @IsOptional() @IsEnum(SeverityLevel) severity?:         SeverityLevel;
  @ApiPropertyOptional() @IsOptional() @IsDateString()        observedAt?:       string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()            lat?:              number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()            lng?:              number;
  @ApiPropertyOptional() @IsOptional() @IsString()            locationDesc?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()            phenologyStage?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()            bbchCode?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()            organismName?:     string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()            infestationPct?:   number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()            incidencePct?:     number;
  @ApiPropertyOptional() @IsOptional() @IsString()            severityDesc?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()            recommendation?:   string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()        deadlineAt?:       string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()           resolved?:         boolean;
  @ApiPropertyOptional() @IsOptional() @IsString()            description?:      string;
  @ApiPropertyOptional() @IsOptional() @IsArray()             images?:           string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID()              authorId?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()            authorName?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString()            authorRole?:       string;
  @ApiPropertyOptional() @IsOptional() @IsArray()             tags?:             string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID()              linkedActivityId?: string;
}
