import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { CashFlowController } from "./cashflow.controller";
import { CashFlowService } from "./cashflow.service";

@Module({
  imports:    [AuthModule],
  controllers: [CashFlowController],
  providers:   [CashFlowService],
  exports:     [CashFlowService],
})
export class CashFlowModule {}
