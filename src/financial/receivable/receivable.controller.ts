import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ReceivableService } from "./receivable.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("receivable") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/receivable")
export class ReceivableController {
  constructor(private readonly receivableService: ReceivableService) {}

  @Get("stats") getStats(@Query("tenantId") tenantId:string, @Query("farmId") farmId?:string) { return this.receivableService.getStats(tenantId,farmId); }
  @Get("categories") getCategories(@Query("tenantId") tenantId:string) { return this.receivableService.getCategories(tenantId); }
  @Get() findAll(@Query("tenantId") tenantId?:string, @Query("farmId") farmId?:string, @Query("status") status?:string, @Query("dateFrom") dateFrom?:string, @Query("dateTo") dateTo?:string, @Query("page") page?:string) {
    return this.receivableService.findAll({tenantId,farmId,status,dateFrom,dateTo,page:page?Number(page):1});
  }
  @Get(":id") findOne(@Param("id") id:string, @Query("tenantId") tenantId?:string) { return this.receivableService.findOne(id,tenantId); }
  @Post() create(@Body() dto:any, @Req() req:any) { return this.receivableService.create(dto,req.user?.id); }
  @Put(":id") update(@Param("id") id:string, @Body() dto:any, @Query("tenantId") tenantId?:string) { return this.receivableService.update(id,dto,tenantId); }
  @Patch(":id/receive") receive(@Param("id") id:string, @Body() dto:any, @Query("tenantId") tenantId?:string) { return this.receivableService.receive(id,dto,tenantId); }
  @Delete(":id") remove(@Param("id") id:string, @Query("tenantId") tenantId?:string) { return this.receivableService.remove(id,tenantId); }
}
