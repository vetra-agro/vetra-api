import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CropCostService } from "./crop-cost.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("crop-cost") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/crop-cost")
export class CropCostController {
  constructor(private readonly cropCostService: CropCostService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string, @Query("farmId") farmId?: string) {
    return this.cropCostService.getStats(tenantId, farmId);
  }

  @Get("compare/:crop")
  @ApiOperation({ summary: "Comparativo entre safras da mesma cultura" })
  compare(
    @Param("crop")     crop:      string,
    @Query("tenantId") tenantId:  string,
    @Query("farmId")   farmId?:   string,
  ) { return this.cropCostService.compareByCrop(tenantId, crop, farmId); }

  @Get(":seasonId")
  getDetail(
    @Param("seasonId") seasonId:  string,
    @Query("tenantId") tenantId?: string,
  ) { return this.cropCostService.getDetail(seasonId, tenantId); }

  @Get()
  findAll(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("crop")     crop?:    string,
    @Query("status")   status?:  string,
  ) { return this.cropCostService.findAll(tenantId, farmId, crop, status); }
}
