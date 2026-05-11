import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AgroSalesService } from "./agro-sales.service";

@ApiTags("agro-sales") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("sales/agro")
export class AgroSalesController {
  constructor(private readonly agroSalesService: AgroSalesService) {}

  @Get("stats")
  getStats(@Query("tenantId") t: string) { return this.agroSalesService.getStats(t); }

  // Contratos
  @Get("contracts")
  findAllContracts(@Query("tenantId") tenantId: string, @Query("status") status?: string,
    @Query("seasonId") seasonId?: string, @Query("crop") crop?: string) {
    return this.agroSalesService.findAllContracts(tenantId, { status, seasonId, crop });
  }
  @Post("contracts")
  createContract(@Body() dto: any, @Req() req: any) {
    return this.agroSalesService.createContract(dto, req.user?.id);
  }
  @Put("contracts/:id")
  updateContract(@Param("id") id: string, @Body() dto: any) {
    return this.agroSalesService.updateContract(id, dto);
  }
  @Post("contracts/:id/deliveries")
  registerDelivery(@Param("id") contractId: string, @Body() dto: any) {
    return this.agroSalesService.registerDelivery({ ...dto, contractId });
  }

  // Fixação
  @Get("pricings")
  findAllPricings(@Query("tenantId") t: string, @Query("status") s?: string, @Query("seasonId") sid?: string) {
    return this.agroSalesService.findAllPricings(t, s, sid);
  }
  @Post("pricings")
  createPricing(@Body() dto: any, @Req() req: any) {
    return this.agroSalesService.createPricing(dto, req.user?.id);
  }
  @Post("pricings/:id/orders")
  addPricingOrder(@Param("id") id: string, @Body() dto: any, @Query("tenantId") tenantId: string) {
    return this.agroSalesService.addPricingOrder(id, dto, tenantId);
  }

  // Volumes
  @Get("volumes")
  getVolumesSummary(@Query("tenantId") t: string, @Query("seasonId") s?: string) {
    return this.agroSalesService.getVolumesSummary(t, s);
  }
  @Get("volumes/timeline")
  getTimeline(@Query("tenantId") t: string, @Query("seasonId") s?: string) {
    return this.agroSalesService.getContractTimeline(t, s);
  }
}