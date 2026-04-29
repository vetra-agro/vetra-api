import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateMachineryDto } from "./create-machinery.dto";
export class UpdateMachineryDto extends PartialType(
  OmitType(CreateMachineryDto, ["tenantId"] as const)
) {}
