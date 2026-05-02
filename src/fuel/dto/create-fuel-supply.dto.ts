import {
  IsString, IsEnum, IsNumber, IsArray, IsBoolean,
  IsOptional, IsUUID, IsDateString, Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum FuelSupplyType {
  DIESEL = "diesel", GASOLINE = "gasoline", ETHANOL = "ethanol",
  BIODIESEL = "biodiesel", ARLA32 = "arla32", OIL = "oil",
  GREASE = "grease", OTHER = "other",
}
export enum SupplySource {
  FARM_TANK = "farm_tank", SUPPLIER = "supplier",
  FUEL_TRUCK = "fuel_truck", GAS_STATION = "gas_station",
}

export class CreateFuelSupplyDto {
  @ApiProperty() @IsUUID()   tenantId: string;
  @ApiProperty() @IsUUID()   farmId:   string;
  @ApiProperty() @IsNumber() @Min(0) quantityL: number;

  @ApiPropertyOptional() @IsOptional() @IsUUID()              tankId?:                string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()              machineryId?:           string;
  @ApiPropertyOptional() @IsOptional() @IsUUID()              thirdPartyVehicleId?:   string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()           isThirdParty?:          boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID()              seasonId?:              string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(FuelSupplyType) fuelType?:             FuelSupplyType;
  @ApiPropertyOptional() @IsOptional() @IsEnum(SupplySource)   source?:               SupplySource;
  @ApiPropertyOptional() @IsOptional() @IsDateString()         suppliedAt?:           string;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             pricePerL?:            number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             totalCost?:            number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             hourmeter?:            number;
  @ApiPropertyOptional() @IsOptional() @IsNumber()             odometerKm?:           number;
  @ApiPropertyOptional() @IsOptional() @IsUUID()               operatorId?:           string;
  @ApiPropertyOptional() @IsOptional() @IsString()             operatorName?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()             supplierName?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()             invoiceNumber?:        string;
  @ApiPropertyOptional() @IsOptional() @IsString()             batchNumber?:          string;
  @ApiPropertyOptional() @IsOptional() @IsString()             notes?:                string;
  @ApiPropertyOptional() @IsOptional() @IsArray()              tags?:                 string[];
}
