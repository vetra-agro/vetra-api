import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { AgroContractsController } from "./agro-contracts.controller";
import { AgroContractsService } from "./agro-contracts.service";

@Module({
  imports: [AuthModule],
  controllers: [AgroContractsController],
  providers:   [AgroContractsService],
  exports:     [AgroContractsService],
})
export class AgroContractsModule {}
