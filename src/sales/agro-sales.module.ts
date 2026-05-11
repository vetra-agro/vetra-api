import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { AgroSalesController } from "./agro-sales.controller";
import { AgroSalesService } from "./agro-sales.service";

@Module({
    imports: [AuthModule],
    controllers: [AgroSalesController],
    providers: [AgroSalesService],
    exports: [AgroSalesService],
})
export class AgroSalesModule { }
