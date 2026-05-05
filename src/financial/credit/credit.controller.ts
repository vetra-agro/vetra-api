import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CreditService } from "./credit.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("credit") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/credit")
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.creditService.getStats(tenantId);
  }

  @Get("aging")
  getAging(@Query("tenantId") tenantId: string) {
    return this.creditService.getAgingReport(tenantId);
  }

  // ── Limites ─────────────────────────────────────────────────────────────
  @Get("limits")
  findAllLimits(@Query("tenantId") tenantId: string, @Query("status") status?: string) {
    return this.creditService.findAllLimits(tenantId, status);
  }

  @Get("limits/:id")
  findLimit(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.creditService.findLimit(id, tenantId);
  }

  @Post("limits")
  upsertLimit(@Body() dto: any, @Req() req: any) {
    return this.creditService.upsertLimit(dto, req.user?.id);
  }

  @Patch("limits/:id/status")
  updateLimitStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Query("tenantId") tenantId?: string,
  ) { return this.creditService.updateLimitStatus(id, status, tenantId); }

  // ── Casos de cobrança ────────────────────────────────────────────────────
  @Get("cases")
  findAllCases(
    @Query("tenantId") tenantId: string,
    @Query("status")   status?:  string,
    @Query("page")     page?:    string,
  ) { return this.creditService.findAllCases(tenantId, status, page ? Number(page) : 1); }

  @Get("cases/:id")
  findCase(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.creditService.findCase(id, tenantId);
  }

  @Post("cases")
  createCase(@Body() dto: any, @Req() req: any) {
    return this.creditService.createCase(dto, req.user?.id);
  }

  @Put("cases/:id")
  updateCase(@Param("id") id: string, @Body() dto: any, @Query("tenantId") tenantId?: string) {
    return this.creditService.updateCase(id, dto, tenantId);
  }

  // ── Contatos ─────────────────────────────────────────────────────────────
  @Post("contacts")
  addContact(@Body() dto: any) {
    return this.creditService.addContact(dto);
  }
}
