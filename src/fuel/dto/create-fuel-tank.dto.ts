import { IsString, IsEnum, IsNumber, IsOptional, IsUUID } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { FuelSupplyType } from "./create-fuel-supply.dto";

export class CreateFuelTankDto {
  @ApiProperty() @IsUUID()   tenantId:  string;
  @ApiProperty() @IsUUID()   farmId:    string;
  @ApiProperty() @IsString() name:      string;
  @ApiProperty() @IsEnum(FuelSupplyType) fuelType: FuelSupplyType;

  @ApiPropertyOptional() @IsOptional() @IsNumber() capacityL?:    number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() minLevelL?:    number;
  @ApiPropertyOptional() @IsOptional() @IsString() locationDesc?: string;
}
