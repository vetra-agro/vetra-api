import {
  IsString, IsEnum, IsNumber, IsArray, IsBoolean,
  IsOptional, IsUUID, IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum MachineryType {
  TRACTOR    = "tractor",   HARVESTER  = "harvester",
  SPRAYER    = "sprayer",   PLANTER    = "planter",
  SPREADER   = "spreader",  TRUCK      = "truck",
  IMPLEMENT  = "implement", IRRIGATION = "irrigation",
  LOADER     = "loader",    OTHER      = "other",
}
export enum MachineryStatus {
  ACTIVE      = "active",   MAINTENANCE = "maintenance",
  IDLE        = "idle",     SOLD        = "sold",
  SCRAPPED    = "scrapped",
}
export enum FuelType {
  DIESEL    = "diesel", GASOLINE = "gasoline",
  FLEX      = "flex",   ELECTRIC = "electric",
  NONE      = "none",
}

export class CreateMachineryDto {
  @ApiProperty() @IsUUID()   tenantId: string;
  @ApiProperty() @IsString() name:     string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()                 farmId?:            string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(MachineryType)    type?:              MachineryType;
  @ApiPropertyOptional() @IsOptional() @IsEnum(MachineryStatus)  status?:            MachineryStatus;
  @ApiPropertyOptional() @IsOptional() @IsString()               brand?:             string;
  @ApiPropertyOptional() @IsOptional() @IsString()               model?:             string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               modelYear?:         number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               manufactureYear?:   number;
  @ApiPropertyOptional() @IsOptional() @IsString()               serialNumber?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString()               licensePlate?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString()               color?:             string;
  @ApiPropertyOptional() @IsOptional() @IsString()               fleetNumber?:       string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()                 assetId?:           string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               assetValue?:        number;
  @ApiPropertyOptional() @IsOptional() @IsDateString()           acquisitionDate?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()               acquisitionDoc?:    string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FuelType)         fuelType?:          FuelType;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               enginePowerHp?:     number;
  @ApiPropertyOptional() @IsOptional() @IsString()               engineModel?:       string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               workingWidthM?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               tankCapacityL?:     number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               weightKg?:          number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               hourmeterCurrent?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               odometerCurrentKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               hourmeterAtPurchase?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               avgConsumptionLH?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               nextServiceH?:      number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               nextServiceKm?:     number;
  @ApiPropertyOptional() @IsOptional() @IsDateString()           nextServiceDate?:   string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()               lastServiceH?:      number;
  @ApiPropertyOptional() @IsOptional() @IsDateString()           lastServiceDate?:   string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()                 currentFieldId?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()               locationNotes?:     string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()                 operatorId?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()               operatorName?:      string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()                 parentId?:          string;
  @ApiPropertyOptional() @IsOptional() @IsString()               insurancePolicy?:   string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()           insuranceExpiry?:   string;
  @ApiPropertyOptional() @IsOptional() @IsDateString()           crvlExpiry?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()               anttNumber?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()               notes?:             string;
  @ApiPropertyOptional() @IsOptional() @IsArray()                tags?:              string[];
}
