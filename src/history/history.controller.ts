import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { HistoryService } from "./history.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("history")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/history")
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get("seasons/:farmId")
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "crop",     required: false })
  @ApiQuery({ name: "status",   required: false })
  getSeasonHistory(
    @Param("farmId")   farmId:    string,
    @Query("tenantId") tenantId?: string,
    @Query("crop")     crop?:     string,
    @Query("status")   status?:   string,
  ) { return this.historyService.getSeasonHistory(farmId, tenantId, { crop, status }); }

  @Get("fields/:farmId")
  @ApiQuery({ name: "tenantId", required: false })
  getFieldHistory(@Param("farmId") farmId: string, @Query("tenantId") tenantId?: string) {
    return this.historyService.getFieldHistory(farmId, tenantId);
  }

  @Get("season-activities/:seasonId")
  getSeasonActivities(@Param("seasonId") seasonId: string) {
    return this.historyService.getSeasonActivities(seasonId);
  }

  @Get("season-sprays/:seasonId")
  getSeasonSprays(@Param("seasonId") seasonId: string) {
    return this.historyService.getSeasonSprays(seasonId);
  }

  @Get("comparison/:farmId/:crop")
  @ApiQuery({ name: "tenantId", required: false })
  getCropComparison(
    @Param("farmId") farmId: string,
    @Param("crop")   crop:   string,
    @Query("tenantId") tenantId?: string,
  ) { return this.historyService.getCropComparison(farmId, crop, tenantId); }

  @Get("kpis/:farmId")
  @ApiQuery({ name: "tenantId", required: false })
  getFarmKpis(@Param("farmId") farmId: string, @Query("tenantId") tenantId?: string) {
    return this.historyService.getFarmKpis(farmId, tenantId);
  }
}
