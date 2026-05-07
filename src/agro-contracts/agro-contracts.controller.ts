// agro-contracts.controller.ts
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AgroContractsService } from "./agro-contracts.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("agro-contracts") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("purchases/agro-contracts")
export class AgroContractsController {
  constructor(private readonly agroContractsService: AgroContractsService) {}

  @Get("stats")
  getStats(@Query("tenantId") tenantId: string) {
    return this.agroContractsService.getStats(tenantId);
  }

  @Get()
  findAll(
    @Query("tenantId")  tenantId:   string,
    @Query("status")    status?:    string,
    @Query("seasonId")  seasonId?:  string,
    @Query("partnerId") partnerId?: string,
    @Query("farmId")    farmId?:    string,
  ) { return this.agroContractsService.findAll(tenantId, { status, seasonId, partnerId, farmId }); }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.agroContractsService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: any, @Req() req: any) {
    return this.agroContractsService.create(dto, req.user?.id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: any, @Query("tenantId") tenantId?: string) {
    return this.agroContractsService.update(id, dto, tenantId);
  }

  @Patch(":id/activate")
  activate(@Param("id") id: string) {
    return this.agroContractsService.activate(id);
  }

  @Post(":id/items")
  addItem(
    @Param("id") contractId: string,
    @Body() dto: any,
    @Query("tenantId") tenantId: string,
  ) { return this.agroContractsService.addItem(contractId, dto, tenantId); }

  @Delete("items/:itemId")
  removeItem(@Param("itemId") itemId: string) {
    return this.agroContractsService.removeItem(itemId);
  }

  @Post(":id/deliveries")
  @ApiOperation({ summary: "Registrar entrega parcial ou total de insumos" })
  registerDelivery(@Param("id") contractId: string, @Body() dto: any) {
    return this.agroContractsService.registerDelivery({ ...dto, contractId });
  }
}
