import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateActivityDto } from "./create-activity.dto";
export class UpdateActivityDto extends PartialType(
  OmitType(CreateActivityDto, ["tenantId","farmId"] as const)
) {}
