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
import { CropCostController } from "./crop-cost/crop-cost.controller";
import { CropCostService }    from "./crop-cost/crop-cost.service";
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [AuthModule],
  controllers: [FinancialController, BanksController, PayableController, ReceivableController, CostCentersController, CreditController, ForexController, CropCostController],
  providers:   [FinancialService, BanksService,    PayableService,    ReceivableService, CostCentersService, CreditService, ForexService, CropCostService],
  exports:     [FinancialService, BanksService,    PayableService,    ReceivableService, CostCentersService, CreditService, ForexService, CropCostService],
})
export class FinancialModule {}
