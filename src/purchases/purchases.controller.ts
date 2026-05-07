import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PurchasesService } from "./purchases.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("purchases") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.purchasesService.getStats(tenantId);
  }

  // ── Aprovadores / Alçadas ──────────────────────────────────────────────
  @Get("approvers")
  @ApiOperation({ summary: "Lista aprovadores e alçadas" })
  findAllApprovers(@Query("tenantId") tenantId: string, @Query("farmId") farmId?: string) {
    return this.purchasesService.findAllApprovers(tenantId, farmId);
  }

  @Post("approvers")
  upsertApprover(@Body() dto: any) {
    return this.purchasesService.upsertApprover(dto);
  }

  @Delete("approvers/:id")
  deleteApprover(@Param("id") id: string) {
    return this.purchasesService.deleteApprover(id);
  }

  @Get("approvers/required")
  @ApiOperation({ summary: "Retorna aprovador necessário para um valor" })
  getRequiredApprovers(
    @Query("tenantId") tenantId: string,
    @Query("value")    value:    string,
    @Query("farmId")   farmId?:  string,
  ) { return this.purchasesService.getRequiredApprovers(tenantId, parseFloat(value), farmId); }

  // ── Parceiros (fornecedores) ───────────────────────────────────────────
  @Get("partners")
  @ApiOperation({ summary: "Lista fornecedores cadastrados" })
  getPartners(@Query("tenantId") tenantId: string) {
    return this.purchasesService.getPartners(tenantId);
  }

  // ── Requisições ────────────────────────────────────────────────────────
  @Get("requests")
  findAllRequests(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("farmId")   farmId?:  string,
  ) { return this.purchasesService.findAllRequests(tenantId, status, farmId); }

  @Post("requests")
  createRequest(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createRequest(dto, req.user?.id);
  }

  @Put("requests/:id")
  updateRequest(@Param("id") id: string, @Body() dto: any) {
    return this.purchasesService.updateRequest(id, dto);
  }

  @Post("requests/:id/quote")
  @ApiOperation({ summary: "Criar cotação a partir de requisição aprovada" })
  createQuoteFromRequest(
    @Param("id") requestId: string,
    @Body() dto: any,
    @Req() req: any,
  ) { return this.purchasesService.createQuoteFromRequest(requestId, dto, req.user?.id); }

  // ── Cotações ───────────────────────────────────────────────────────────
  @Get("quotes")
  findAllQuotes(@Query("tenantId") tenantId: string, @Query("status") status?: string) {
    return this.purchasesService.findAllQuotes(tenantId, status);
  }

  @Post("quotes")
  createQuote(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createQuote(dto, req.user?.id);
  }

  @Post("quotes/response")
  addQuoteResponse(@Body() dto: any) {
    return this.purchasesService.addQuoteResponse(dto);
  }

  @Get("quotes/:id/comparison")
  getComparison(@Param("id") id: string) {
    return this.purchasesService.getQuoteComparison(id);
  }

  @Patch("quotes/:id/award/:responseId")
  awardQuote(
    @Param("id")           id:         string,
    @Param("responseId")   responseId: string,
    @Query("tenantId")     tenantId:   string,
  ) { return this.purchasesService.awardQuote(id, responseId, tenantId); }

  // ── Pedidos ────────────────────────────────────────────────────────────
  @Get("orders")
  findAllOrders(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("farmId")   farmId?:  string,
    @Query("page")     page?:    string,
  ) { return this.purchasesService.findAllOrders(tenantId, { status, farmId, page: page ? +page : 1 }); }

  @Post("orders")
  createOrder(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createOrder(dto, req.user?.id);
  }

  @Post("orders/from-quote")
  @ApiOperation({ summary: "Criar pedido a partir de cotação adjudicada" })
  createOrderFromQuote(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createOrderFromQuote(dto.quoteId, dto.responseId, dto, req.user?.id);
  }

  @Post("orders/from-contract/:contractId")
  @ApiOperation({ summary: "Criar pedido a partir de contrato ativo" })
  createOrderFromContract(
    @Param("contractId") contractId: string,
    @Body() dto: any,
    @Req() req: any,
  ) { return this.purchasesService.createOrderFromContract(contractId, dto, req.user?.id); }

  @Put("orders/:id")
  updateOrder(@Param("id") id: string, @Body() dto: any) {
    return this.purchasesService.updateOrder(id, dto);
  }

  @Patch("orders/:id/submit")
  submitForApproval(@Param("id") id: string) {
    return this.purchasesService.submitForApproval(id);
  }

  // ── Aprovações ─────────────────────────────────────────────────────────
  @Get("approvals/pending")
  getPendingApprovals(@Query("tenantId") tenantId: string) {
    return this.purchasesService.getPendingApprovals(tenantId);
  }

  @Post("approvals/:orderId")
  approve(
    @Param("orderId")  orderId:  string,
    @Body()            dto:      any,
    @Query("tenantId") tenantId: string,
  ) { return this.purchasesService.approve(orderId, dto, tenantId); }

  // ── Contratos ──────────────────────────────────────────────────────────
  @Get("contracts")
  findAllContracts(@Query("tenantId") tenantId: string, @Query("status") status?: string) {
    return this.purchasesService.findAllContracts(tenantId, status);
  }

  @Post("contracts")
  createContract(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createContract(dto, req.user?.id);
  }

  @Put("contracts/:id")
  updateContract(@Param("id") id: string, @Body() dto: any) {
    return this.purchasesService.updateContract(id, dto);
  }

  // ── Entregas ───────────────────────────────────────────────────────────
  @Get("deliveries")
  findAllDeliveries(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("dateFrom") dateFrom?:string,
    @Query("dateTo")   dateTo?:  string,
  ) { return this.purchasesService.findAllDeliveries(tenantId, status, dateFrom, dateTo); }

  @Post("deliveries")
  createDelivery(@Body() dto: any, @Req() req: any) {
    return this.purchasesService.createDelivery(dto, req.user?.id);
  }

  @Patch("deliveries/:id/receive")
  receiveDelivery(@Param("id") id: string, @Body() dto: any) {
    return this.purchasesService.receiveDelivery(id, dto);
  }
}
