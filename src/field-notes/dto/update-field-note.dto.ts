import { PartialType, OmitType } from "@nestjs/swagger";
import { CreateFieldNoteDto } from "./create-field-note.dto";
export class UpdateFieldNoteDto extends PartialType(
  OmitType(CreateFieldNoteDto, ["tenantId", "farmId"] as const)
) {}
