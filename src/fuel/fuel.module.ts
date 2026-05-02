import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { FuelController } from "./fuel.controller";
import { FuelService } from "./fuel.service";

@Module({
  imports: [AuthModule],
  controllers: [FuelController],
  providers: [FuelService],
  exports: [FuelService],
})
export class FuelModule {}
