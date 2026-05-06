import { Module } from "@nestjs/common";
import { CropCostController } from "./crop-cost.controller";
import { CropCostService } from "./crop-cost.service";

@Module({
  controllers: [CropCostController],
  providers:   [CropCostService],
  exports:     [CropCostService],
})
export class CropCostModule {}
