import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CashFlowService } from "./cashflow.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("cashflow") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/cashflow")
export class CashFlowController {
  constructor(private readonly cashFlowService: CashFlowService) {}

  @Get("summary")
  getSummary(
    @Query("tenantId") tenantId: string,
    @Query("bankAccountId") bankAccountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) { return this.cashFlowService.getSummary(tenantId, bankAccountId, dateFrom, dateTo); }

  @Get("daily-balance")
  getDailyBalance(
    @Query("tenantId") tenantId: string,
    @Query("bankAccountId") bankAccountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) { return this.cashFlowService.getDailyBalance(tenantId, bankAccountId, dateFrom, dateTo); }

  @Get("imports")
  getImportHistory(@Query("tenantId") tenantId: string) {
    return this.cashFlowService.getImportHistory(tenantId);
  }

  @Get()
  getEntries(
    @Query("tenantId") tenantId: string,
    @Query("bankAccountId") bankAccountId?: string,
    @Query("farmId") farmId?: string,
    @Query("direction") direction?: string,
    @Query("reconcileStatus") reconcileStatus?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("page") page?: string,
  ) {
    return this.cashFlowService.getEntries({
      tenantId, bankAccountId, farmId, direction, reconcileStatus,
      dateFrom, dateTo, page: page ? Number(page) : 1,
    });
  }

  @Post()
  createEntry(@Body() dto: any, @Req() req: any) {
    return this.cashFlowService.createEntry(dto, req.user?.id);
  }

  @Post("import")
  @ApiOperation({ summary: "Importar extrato OFX ou CNAB 240/400" })
  importEntries(@Body() dto: any, @Req() req: any) {
    return this.cashFlowService.importEntries(dto, req.user?.id);
  }

  @Post("reconcile")
  @ApiOperation({ summary: "Disparar conciliação automática" })
  reconcile(@Body() body: { tenantId: string; bankAccountId: string }) {
    return this.cashFlowService.autoReconcile(body.tenantId, body.bankAccountId);
  }

  @Put(":id")
  updateEntry(@Param("id") id: string, @Body() dto: any) {
    return this.cashFlowService.updateEntry(id, dto);
  }

  @Delete(":id")
  deleteEntry(@Param("id") id: string) {
    return this.cashFlowService.deleteEntry(id);
  }
}
