import { Module } from "@nestjs/common";
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { BanksController }      from "./banks/banks.controller";
import { BanksService }         from "./banks/banks.service";
import { PayableController }    from "./payable/payable.controller";
import { PayableService }       from "./payable/payable.service";
import { ReceivableController } from "./receivable/receivable.controller";
import { ReceivableService }    from "./receivable/receivable.service";
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [AuthModule],
  controllers: [FinancialController, BanksController, PayableController, ReceivableController],
  providers:   [FinancialService, BanksService,    PayableService,    ReceivableService],
  exports:     [FinancialService, BanksService,    PayableService,    ReceivableService],
})
export class FinancialModule {}
