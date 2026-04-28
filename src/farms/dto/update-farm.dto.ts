import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateFarmDto } from "./create-farm.dto";

export class UpdateFarmDto extends PartialType(
  OmitType(CreateFarmDto, ["tenantId"] as const)
) {}
