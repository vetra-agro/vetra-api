import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { BanksService } from "./banks.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("banks") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/banks")
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Get("list") getBankList() { return this.banksService.getBankList(); }
  @Get("stats") getStats(@Query("tenantId") tenantId: string) { return this.banksService.getStats(tenantId); }
  @Get() findAll(@Query("tenantId") tenantId: string, @Query("farmId") farmId?: string) { return this.banksService.findAll(tenantId, farmId); }
  @Get(":id") findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) { return this.banksService.findOne(id, tenantId); }
  @Post() create(@Body() dto: any, @Req() req: any) { return this.banksService.create(dto, req.user?.id); }
  @Put(":id") update(@Param("id") id: string, @Body() dto: any, @Query("tenantId") tenantId?: string) { return this.banksService.update(id, dto, tenantId); }
}
