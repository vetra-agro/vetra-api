import { PartialType, OmitType } from "@nestjs/swagger";
import { CreatePhytoDto } from "./create-phyto.dto";
export class UpdatePhytoDto extends PartialType(
  OmitType(CreatePhytoDto, ["tenantId","farmId"] as const)
) {}
