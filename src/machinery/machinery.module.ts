import { Module } from "@nestjs/common";
import { AuthModule } from '../auth/auth.module';
import { MachineryController } from "./machinery.controller";
import { MachineryService } from "./machinery.service";

@Module({
  imports: [AuthModule],
  controllers: [MachineryController],
  providers: [MachineryService],
  exports: [MachineryService],
})
export class MachineryModule {}
