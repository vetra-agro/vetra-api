import { Module } from "@nestjs/common";
import { BanksController }      from "./banks/banks.controller";
import { BanksService }         from "./banks/banks.service";
import { PayableController }    from "./payable/payable.controller";
import { PayableService }       from "./payable/payable.service";
import { ReceivableController } from "./receivable/receivable.controller";
import { ReceivableService }    from "./receivable/receivable.service";
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [AuthModule],
  controllers: [BanksController, PayableController, ReceivableController],
  providers:   [BanksService,    PayableService,    ReceivableService],
  exports:     [BanksService,    PayableService,    ReceivableService],
})
export class FinancialModule {}
