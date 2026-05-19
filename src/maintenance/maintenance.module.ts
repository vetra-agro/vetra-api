import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

@Module({
  imports: [AuthModule],
  controllers: [MaintenanceController],
  providers:   [MaintenanceService],
  exports:     [MaintenanceService],
})
export class MaintenanceModule {}