import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { LogisticsService } from "./logistics.service";

@ApiTags("logistics") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("logistics")
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @Get("stats")
  getStats(@Query("tenantId") t: string) { return this.logisticsService.getStats(t); }

  // Transportadoras
  @Get("carriers") findAllCarriers(@Query("tenantId") t: string) { return this.logisticsService.findAllCarriers(t); }
  @Post("carriers") upsertCarrier(@Body() dto: any) { return this.logisticsService.upsertCarrier(dto); }

  // Motoristas
  @Get("drivers") findAllDrivers(@Query("tenantId") t: string, @Query("carrierId") c?: string) { return this.logisticsService.findAllDrivers(t, c); }
  @Post("drivers") upsertDriver(@Body() dto: any) { return this.logisticsService.upsertDriver(dto); }

  // Veículos
  @Get("vehicles") findAllVehicles(@Query("tenantId") t: string, @Query("carrierId") c?: string) { return this.logisticsService.findAllVehicles(t, c); }
  @Post("vehicles") upsertVehicle(@Body() dto: any) { return this.logisticsService.upsertVehicle(dto); }

  // Ordens de frete
  @Get("freight")
  findAllFreightOrders(@Query("tenantId") tenantId: string, @Query("status") status?: string,
    @Query("cargoType") cargoType?: string, @Query("page") page?: string) {
    return this.logisticsService.findAllFreightOrders(tenantId, { status, cargoType, page: page ? +page : 1 });
  }
  @Get("freight/:id")
  findFreightById(@Param("id") id: string, @Query("tenantId") tenantId: string) {
    return this.logisticsService.findFreightOrderById(id, tenantId);
  }
  @Post("freight") createFreightOrder(@Body() dto: any, @Req() req: any) { return this.logisticsService.createFreightOrder(dto, req.user?.id); }
  @Put("freight/:id") updateFreightOrder(@Param("id") id: string, @Body() dto: any) { return this.logisticsService.updateFreightOrder(id, dto); }

  // Pernas
  @Post("freight/:id/legs") addLeg(@Param("id") id: string, @Body() dto: any) { return this.logisticsService.addLeg({ ...dto, freightOrderId: id }); }
  @Put("legs/:id") updateLeg(@Param("id") id: string, @Body() dto: any) { return this.logisticsService.updateLeg(id, dto); }

  // Tracking
  @Get("legs/:id/tracking") getTracking(@Param("id") id: string) { return this.logisticsService.getTracking(id); }
  @Post("legs/:id/tracking") addTracking(@Param("id") id: string, @Body() dto: any) { return this.logisticsService.addTracking({ ...dto, freightLegId: id }); }

  // Romaneios
  @Get("manifests") findAllManifests(@Query("tenantId") t: string, @Query("farmId") f?: string) { return this.logisticsService.findAllManifests(t, f); }
  @Post("manifests") upsertManifest(@Body() dto: any, @Req() req: any) { return this.logisticsService.upsertManifest(dto, req.user?.id); }

  // Custo por contrato
  @Get("cost") getCostByContract(@Query("tenantId") t: string) { return this.logisticsService.getCostByContract(t); }
}

