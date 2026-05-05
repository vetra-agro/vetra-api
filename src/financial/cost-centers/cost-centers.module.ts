import { Module } from "@nestjs/common";
import { AuthModule } from '../../auth/auth.module';
import { CostCentersController } from "./cost-centers.controller";
import { CostCentersService } from "./cost-centers.service";

@Module({
  imports: [AuthModule],
  controllers: [CostCentersController],
  providers:   [CostCentersService],
  exports:     [CostCentersService],
})
export class CostCentersModule {}
