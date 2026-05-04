import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { ReconciliationService } from "./reconciliation.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("reconciliation") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/reconciliation")
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get("panel/:bankAccountId")
  @ApiOperation({ summary: "Painel de conciliação bancária" })
  getPanel(
    @Param("bankAccountId") bankAccountId: string,
    @Query("tenantId")      tenantId:      string,
    @Query("dateFrom")      dateFrom:      string,
    @Query("dateTo")        dateTo:        string,
  ) { return this.reconciliationService.getReconciliationPanel(bankAccountId, tenantId, dateFrom, dateTo); }

  @Post("match")
  @ApiOperation({ summary: "Conciliar manualmente extrato com ERP" })
  matchManual(@Body() dto: any) {
    return this.reconciliationService.matchManual(dto);
  }

  @Patch("ignore/:entryId")
  @ApiOperation({ summary: "Ignorar lançamento do extrato" })
  ignore(@Param("entryId") entryId: string, @Body("tenantId") tenantId: string) {
    return this.reconciliationService.ignoreEntry(entryId, tenantId);
  }

  @Post("create-from-bank")
  @ApiOperation({ summary: "Criar lançamento ERP a partir do extrato" })
  createFromBank(@Body() dto: any) {
    return this.reconciliationService.createFromBank(dto);
  }

  @Post("auto/:bankAccountId")
  @ApiOperation({ summary: "Conciliação automática do período" })
  autoReconcile(
    @Param("bankAccountId") bankAccountId: string,
    @Body() body: { tenantId: string; dateFrom: string; dateTo: string },
  ) {
    return this.reconciliationService.autoReconcilePeriod(
      bankAccountId, body.tenantId, body.dateFrom, body.dateTo,
    );
  }
}
