import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { LogisticsController } from "./logistics.controller";
import { LogisticsService } from "./logistics.service";

@Module({
  imports:    [AuthModule],
  controllers: [LogisticsController],
  providers:   [LogisticsService],
  exports:     [LogisticsService],
})
export class LogisticsModule {}