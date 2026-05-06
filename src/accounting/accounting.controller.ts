import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AccountingService } from "./accounting.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("accounting") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/accounting")
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.accountingService.getStats(tenantId);
  }

  // ── Plano de Contas ────────────────────────────────────────────────────
  @Get("accounts")
  getAccounts(@Query("tenantId") tenantId: string, @Query("groupType") groupType?: string) {
    return this.accountingService.getChartOfAccounts(tenantId, groupType);
  }

  @Post("accounts")
  createAccount(@Body() dto: any) {
    return this.accountingService.createAccount(dto);
  }

  @Put("accounts/:id")
  updateAccount(@Param("id") id: string, @Body() dto: any) {
    return this.accountingService.updateAccount(id, dto);
  }

  // ── Lançamentos ────────────────────────────────────────────────────────
  @Get("entries")
  findAllEntries(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("dateFrom") dateFrom?:string,
    @Query("dateTo")   dateTo?:  string,
    @Query("page")     page?:    string,
  ) { return this.accountingService.findAllEntries(tenantId, { status, dateFrom, dateTo, page: page ? +page : 1 }); }

  @Post("entries")
  createEntry(@Body() dto: any, @Req() req: any) {
    return this.accountingService.createEntry(dto, req.user?.id);
  }

  @Patch("entries/:id/post")
  postEntry(@Param("id") id: string, @Req() req: any) {
    return this.accountingService.postEntry(id, req.user?.id);
  }

  @Post("entries/:id/reverse")
  reverseEntry(@Param("id") id: string, @Body("description") description: string, @Req() req: any) {
    return this.accountingService.reverseEntry(id, description, req.user?.id);
  }

  // ── DRE ────────────────────────────────────────────────────────────────
  @Get("dre")
  getDRE(
    @Query("tenantId") tenantId: string,
    @Query("dateFrom") dateFrom: string,
    @Query("dateTo")   dateTo:   string,
    @Query("farmId")   farmId?:  string,
  ) { return this.accountingService.getDRE(tenantId, dateFrom, dateTo, farmId); }

  // ── Ativos ─────────────────────────────────────────────────────────────
  @Get("assets")
  findAllAssets(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("farmId")   farmId?:  string,
  ) { return this.accountingService.findAllAssets(tenantId, status, farmId); }

  @Post("assets")
  createAsset(@Body() dto: any, @Req() req: any) {
    return this.accountingService.createAsset(dto, req.user?.id);
  }

  @Put("assets/:id")
  updateAsset(@Param("id") id: string, @Body() dto: any) {
    return this.accountingService.updateAsset(id, dto);
  }

  @Post("assets/depreciate-all")
  @ApiOperation({ summary: "Depreciar todos os ativos ativos no período" })
  depreciateAll(@Body() body: { tenantId: string; year: number; month: number }) {
    return this.accountingService.depreciateAll(body.tenantId, body.year, body.month);
  }

  @Post("assets/:id/depreciate")
  depreciateOne(
    @Param("id") id: string,
    @Body() body: { tenantId: string; year: number; month: number },
  ) { return this.accountingService.depreciateAsset(id, body.year, body.month, body.tenantId); }
}
