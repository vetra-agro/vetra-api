import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateFuelSupplyDto } from "./create-fuel-supply.dto";
export class UpdateFuelSupplyDto extends PartialType(
  OmitType(CreateFuelSupplyDto, ["tenantId","farmId"] as const)
) {}
