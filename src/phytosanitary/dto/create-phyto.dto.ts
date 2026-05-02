import {
  IsString, IsEnum, IsNumber, IsBoolean, IsArray,
  IsOptional, IsUUID, IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum ApplicationMethod {
  AERIAL        = "aerial",        GROUND_BOOM  = "ground_boom",
  GROUND_KNAP   = "ground_knap",   PIVOT        = "pivot",
  DRIP          = "drip",          GRANULAR     = "granular",
  SEED_TREATMENT= "seed_treatment",
}

export class CreatePhytoDto {
  @ApiProperty() @IsUUID()      tenantId:  string;
  @ApiProperty() @IsUUID()      farmId:    string;
  @ApiProperty() @IsDateString() appliedAt: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()               seasonId?:           string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               fieldNoteId?:        string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               activityId?:         string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(ApplicationMethod) method?:           ApplicationMethod;
  @ApiPropertyOptional() @IsOptional() @IsDateString()         finishedAt?:         string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              fieldIds?:           string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber()             areaHa?:             number;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               machineryId?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()             machineryName?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString()             nozzleType?:         string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             nozzleSpacingM?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             pressureBar?:        number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             volumeHaL?:          number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             totalVolumeL?:       number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             speedKmh?:           number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             heightM?:            number;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               operatorId?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()             operatorName?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString()             agronomistName?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()             agronomistCrea?:     string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              products?:           any[];
  @ApiPropertyOptional() @IsOptional() @IsNumber()             tempC?:              number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             humidityPct?:        number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             windSpeedKmh?:       number;
  @ApiPropertyOptional() @IsOptional() @IsString()             windDir?:            string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             cloudCoverPct?:      number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()            conditionOk?:        boolean;
  @ApiPropertyOptional() @IsOptional() @IsString()             conditionNotes?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()             prescriptionNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()             invoiceNumber?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString()             batchNumber?:        string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()         reentryDate?:        string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             efficacyPct?:        number;
  @ApiPropertyOptional() @IsOptional() @IsString()             efficacyNotes?:      string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()         efficacyAt?:         string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             productCost?:        number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             serviceCost?:        number;
  @ApiPropertyOptional() @IsOptional() @IsString()             notes?:              string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              tags?:               string[];
}
