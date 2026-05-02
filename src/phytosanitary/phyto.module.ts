import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { PhytoController } from "./phyto.controller";
import { PhytoService } from "./phyto.service";

@Module({
  imports: [AuthModule],
  controllers: [PhytoController],
  providers: [PhytoService],
  exports: [PhytoService],
})
export class PhytoModule {}
