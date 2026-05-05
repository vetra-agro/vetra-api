import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CostCentersService } from "./cost-centers.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("cost-centers") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/cost-centers")
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.costCentersService.getStats(tenantId);
  }

  @Get("breakdown")
  getBreakdown(
    @Query("tenantId") tenantId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo")   dateTo?:   string,
  ) { return this.costCentersService.getBreakdown(tenantId, dateFrom, dateTo); }

  @Post("seed")
  @ApiOperation({ summary: "Criar centros padrão para o tenant" })
  seed(@Body("tenantId") tenantId: string) {
    return this.costCentersService.seedDefaults(tenantId);
  }

  @Get()
  findAll(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("type")     type?:    string,
  ) { return this.costCentersService.findAll(tenantId, farmId, type); }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.costCentersService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: any) { return this.costCentersService.create(dto); }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: any, @Query("tenantId") tenantId?: string) {
    return this.costCentersService.update(id, dto, tenantId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.costCentersService.remove(id, tenantId);
  }
}
