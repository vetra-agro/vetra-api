import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { FieldNotesController } from "./field-notes.controller";
import { FieldNotesService } from "./field-notes.service";

@Module({
  imports: [AuthModule],
  controllers: [FieldNotesController],
  providers: [FieldNotesService],
  exports: [FieldNotesService],
})
export class FieldNotesModule {}
