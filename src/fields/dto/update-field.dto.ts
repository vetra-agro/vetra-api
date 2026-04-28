import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateFieldDto } from "./create-field.dto";

export class UpdateFieldDto extends PartialType(
  OmitType(CreateFieldDto, ["farmId","tenantId"] as const)
) {}
