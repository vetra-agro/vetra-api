import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { ForexService } from "./forex.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("forex") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/forex")
export class ForexController {
  constructor(private readonly forexService: ForexService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.forexService.getStats(tenantId);
  }

  @Get("rate")
  @ApiOperation({ summary: "Taxa de câmbio atual (USD/BRL)" })
  getRate(@Query("currency") currency?: string) {
    return this.forexService.getCurrentRate(currency ?? "USD");
  }

  // ── Operações ──────────────────────────────────────────────────────────
  @Get("operations")
  findAll(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("seasonId") seasonId?:string,
    @Query("status")   status?:  string,
    @Query("page")     page?:    string,
  ) { return this.forexService.findAllOperations({ tenantId, farmId, seasonId, status, page: page ? +page : 1 }); }

  @Post("operations")
  create(@Body() dto: any, @Req() req: any) {
    return this.forexService.createOperation(dto, req.user?.id);
  }

  @Put("operations/:id")
  update(@Param("id") id: string, @Body() dto: any) {
    return this.forexService.updateOperation(id, dto);
  }

  @Patch("operations/:id/settle")
  @ApiOperation({ summary: "Liquidar operação de câmbio" })
  settle(@Param("id") id: string, @Body() dto: any) {
    return this.forexService.settleOperation(id, dto);
  }

  @Delete("operations/:id")
  remove(@Param("id") id: string) {
    return this.forexService.removeOperation(id);
  }

  // ── Contratos ──────────────────────────────────────────────────────────
  @Get("contracts")
  findAllContracts(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("seasonId") seasonId?:string,
  ) { return this.forexService.findAllContracts(tenantId, farmId, seasonId); }

  @Post("contracts")
  createContract(@Body() dto: any, @Req() req: any) {
    return this.forexService.createContract(dto, req.user?.id);
  }

  @Put("contracts/:id")
  updateContract(@Param("id") id: string, @Body() dto: any) {
    return this.forexService.updateContract(id, dto);
  }

  @Get("contracts/:id/links")
  getContractLinks(@Param("id") id: string) {
    return this.forexService.getContractLinks(id);
  }

  // ── Vínculos ───────────────────────────────────────────────────────────
  @Post("links")
  @ApiOperation({ summary: "Vincular operação de câmbio a contrato de venda" })
  link(@Body() dto: any) { return this.forexService.linkOperationToContract(dto); }

  @Delete("links/:id")
  unlink(@Param("id") id: string) { return this.forexService.unlinkOperation(id); }

  // ── Exposição ──────────────────────────────────────────────────────────
  @Get("exposure")
  @ApiOperation({ summary: "Exposição cambial consolidada" })
  getExposure(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("seasonId") seasonId?:string,
  ) { return this.forexService.getExposure(tenantId, farmId, seasonId); }

  // ── Simulação ──────────────────────────────────────────────────────────
  @Post("simulate")
  @ApiOperation({ summary: "Simular cenários de taxa de câmbio" })
  simulate(@Body() dto: any) { return this.forexService.simulate(dto); }
}
