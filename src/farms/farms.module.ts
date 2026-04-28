import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { FarmsController } from "./farms.controller";
import { FarmsService } from "./farms.service";

 
@Module({
  imports: [AuthModule],
  controllers: [FarmsController],
  providers: [FarmsService],
  exports: [FarmsService],
})
export class FarmsModule {}
