import {
  IsString, IsEnum, IsNumber, IsBoolean, IsArray,
  IsOptional, IsUUID, Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum FieldStatus {
  ACTIVE    = "active",
  FALLOW    = "fallow",
  PREPARING = "preparing",
  INACTIVE  = "inactive",
}

export enum IrrigationType {
  NONE       = "none",
  PIVOT      = "pivot",
  DRIP       = "drip",
  SPRINKLER  = "sprinkler",
  FLOOD      = "flood",
  SUBSURFACE = "subsurface",
}

export class CreateFieldDto {
  @ApiProperty() @IsUUID() farmId:   string;
  @ApiProperty() @IsUUID() tenantId: string;
  @ApiProperty() @IsString() name:   string;

  @ApiPropertyOptional() @IsOptional() @IsString() code?:    string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FieldStatus) status?: FieldStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() color?:   string;
  @ApiPropertyOptional() @IsOptional() @IsArray()  crops?:   string[];
  @ApiProperty()         @IsNumber() @Min(0)       areaHa:   number;
  @ApiPropertyOptional() @IsOptional() @IsString() soilType?:  string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() slopePct?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() altitudeM?: number;
  @ApiPropertyOptional() @IsOptional() @IsEnum(IrrigationType) irrigation?: IrrigationType;
  @ApiPropertyOptional() @IsOptional() @IsString() currentSeason?: string;
  @ApiPropertyOptional({ description: "Array de [lng, lat]" })
  @IsOptional() @IsArray() boundaryCoords?: [number, number][];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray()  tags?:  string[];
}
