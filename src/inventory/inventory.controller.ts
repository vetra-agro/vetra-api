import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { InventoryService } from "./inventory.service";

@ApiTags("inventory") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("inventory")
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get("stats") getStats(@Query("tenantId") t: string) { return this.svc.getStats(t); }

  // Catálogo
  @Get("items") findAllItems(@Query("tenantId") t: string, @Query("category") c?: string, @Query("search") s?: string) {
    return this.svc.findAllItems(t, { category:c, search:s });
  }
  @Post("items") upsertItem(@Body() dto: any) { return this.svc.upsertItem(dto); }

  // Localizações
  @Get("locations") findAllLocations(@Query("tenantId") t: string, @Query("farmId") f?: string) {
    return this.svc.findAllLocations(t, f);
  }
  @Post("locations") upsertLocation(@Body() dto: any) { return this.svc.upsertLocation(dto); }

  // Saldos
  @Get("balances") getBalances(@Query("tenantId") t: string, @Query("locationId") l?: string,
    @Query("category") c?: string, @Query("belowMin") bm?: string, @Query("search") s?: string) {
    return this.svc.getBalances(t, { locationId:l, category:c, belowMin:bm==="true", search:s });
  }
  @Patch("balances/:itemId/min") updateMinMax(@Param("itemId") id: string, @Body() dto: any) {
    return this.svc.updateMinMax(id, dto.locationId ?? null, dto);
  }

  // Movimentações
  @Get("moves") findAllMoves(@Query("tenantId") t: string, @Query("moveType") mt?: string,
    @Query("status") s?: string, @Query("itemId") i?: string, @Query("page") pg?: string) {
    return this.svc.findAllMoves(t, { moveType:mt, status:s, itemId:i, page:pg?+pg:1 });
  }
  @Post("moves") createMove(@Body() dto: any, @Req() req: any) {
    return this.svc.createMove(dto, req.user?.id);
  }
  @Patch("moves/:id/confirm") confirmMove(@Param("id") id: string) { return this.svc.confirmMove(id); }
  @Patch("moves/:id/cancel") cancelMove(@Param("id") id: string, @Body() dto: any) {
    return this.svc.cancelMove(id, dto);
  }

  // Ajuste de inventário
  @Post("adjust") adjust(@Body() dto: any, @Req() req: any) {
    return this.svc.adjustInventory(dto, req.user?.id);
  }

  // Lotes
  @Get("lots") findAllLots(@Query("tenantId") t: string, @Query("itemId") i?: string, @Query("status") s?: string) {
    return this.svc.findAllLots(t, i, s);
  }
  @Post("lots") upsertLot(@Body() dto: any) { return this.svc.upsertLot(dto); }

  // Qualidade
  @Get("quality") findAllQuality(@Query("tenantId") t: string, @Query("itemId") i?: string) {
    return this.svc.findAllQuality(t, i);
  }
  @Post("quality") upsertQuality(@Body() dto: any) { return this.svc.upsertQuality(dto); }
}

