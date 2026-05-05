import { Module } from "@nestjs/common";
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { BanksController }      from "./banks/banks.controller";
import { BanksService }         from "./banks/banks.service";
import { PayableController }    from "./payable/payable.controller";
import { PayableService }       from "./payable/payable.service";
import { ReceivableController } from "./receivable/receivable.controller";
import { ReceivableService }    from "./receivable/receivable.service";
import { CostCentersController } from "./cost-centers/cost-centers.controller";
import { CostCentersService }    from "./cost-centers/cost-centers.service";
import { CreditController } from "./credit/credit.controller";
import { CreditService }    from "./credit/credit.service";
import { ForexController } from "./forex/forex.controller";
import { ForexService }    from "./forex/forex.service";
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [AuthModule],
  controllers: [FinancialController, BanksController, PayableController, ReceivableController, CostCentersController, CreditController, ForexController],
  providers:   [FinancialService, BanksService,    PayableService,    ReceivableService, CostCentersService, CreditService, ForexService],
  exports:     [FinancialService, BanksService,    PayableService,    ReceivableService, CostCentersService, CreditService, ForexService],
})
export class FinancialModule {}
