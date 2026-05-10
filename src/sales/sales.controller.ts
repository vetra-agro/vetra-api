// sales.controller.ts
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { SalesService } from "./sales.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("sales") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("sales")
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.salesService.getStats(tenantId);
  }

  // ── Produtos ────────────────────────────────────────────────────────────
  @Get("products")
  findAllProducts(@Query("tenantId") tenantId: string, @Query("type") type?: string) {
    return this.salesService.findAllProducts(tenantId, type);
  }

  @Post("products")
  upsertProduct(@Body() dto: any) {
    return this.salesService.upsertProduct(dto);
  }

  // ── Tabela de Preços ────────────────────────────────────────────────────
  @Get("price-lists")
  findAllPriceLists(
    @Query("tenantId")  tenantId:   string,
    @Query("productId") productId?: string,
    @Query("all")       all?:       string,
  ) { return this.salesService.findAllPriceLists(tenantId, productId, all !== "true"); }

  @Post("price-lists")
  upsertPriceList(@Body() dto: any) {
    return this.salesService.upsertPriceList(dto);
  }

  // ── Pedidos / Orçamentos ────────────────────────────────────────────────
  @Get("orders")
  findAllOrders(
    @Query("tenantId")  tenantId:   string,
    @Query("status")    status?:    string,
    @Query("isQuote")   isQuote?:   string,
    @Query("farmId")    farmId?:    string,
    @Query("seasonId")  seasonId?:  string,
    @Query("partnerId") partnerId?: string,
    @Query("page")      page?:      string,
  ) {
    return this.salesService.findAllOrders(tenantId, {
      status, farmId, seasonId, partnerId,
      isQuote: isQuote !== undefined ? isQuote === "true" : undefined,
      page: page ? +page : 1,
    });
  }

  @Get("orders/:id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId: string) {
    return this.salesService.findOne(id, tenantId);
  }

  @Post("orders")
  createOrder(@Body() dto: any, @Req() req: any) {
    return this.salesService.createOrder(dto, req.user?.id);
  }

  @Put("orders/:id")
  updateOrder(@Param("id") id: string, @Body() dto: any) {
    return this.salesService.updateOrder(id, dto);
  }

  @Patch("orders/:id/submit")
  submitForApproval(@Param("id") id: string) {
    return this.salesService.submitForApproval(id);
  }

  @Patch("orders/:id/convert")
  @ApiOperation({ summary: "Converte orçamento em pedido de venda" })
  convertQuoteToOrder(@Param("id") id: string) {
    return this.salesService.convertQuoteToOrder(id);
  }

  // ── Aprovações ──────────────────────────────────────────────────────────
  @Get("approvals/pending")
  getPendingApprovals(@Query("tenantId") tenantId: string) {
    return this.salesService.getPendingApprovals(tenantId);
  }

  @Post("approvals/:orderId")
  approve(
    @Param("orderId")  orderId:  string,
    @Body()            dto:      any,
    @Query("tenantId") tenantId: string,
  ) { return this.salesService.approve(orderId, dto, tenantId); }

  // ── Comissões ───────────────────────────────────────────────────────────
  @Get("commissions")
  findAllCommissions(
    @Query("tenantId")   tenantId:    string,
    @Query("status")     status?:     string,
    @Query("salesperson")salesperson?:string,
  ) { return this.salesService.findAllCommissions(tenantId, { status, salesperson }); }

  @Get("commissions/summary")
  getCommissionSummary(@Query("tenantId") tenantId: string) {
    return this.salesService.getCommissionSummary(tenantId);
  }

  @Patch("commissions/:id/pay")
  payCommission(@Param("id") id: string, @Body() dto: any) {
    return this.salesService.payCommission(id, dto);
  }

  // ── Clientes ────────────────────────────────────────────────────────────
  @Get("buyers")
  getBuyers(@Query("tenantId") tenantId: string) {
    return this.salesService.getBuyers(tenantId);
  }
}

