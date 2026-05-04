import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PayableService } from "./payable.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";

@ApiTags("payable") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("financial/payable")
export class PayableController {
  constructor(private readonly payableService: PayableService) {}

  @Get("stats") getStats(@Query("tenantId") tenantId:string, @Query("farmId") farmId?:string) { return this.payableService.getStats(tenantId,farmId); }
  @Get("categories") getCategories(@Query("tenantId") tenantId:string) { return this.payableService.getCategories(tenantId); }
  @Get() findAll(@Query("tenantId") tenantId?:string, @Query("farmId") farmId?:string, @Query("status") status?:string, @Query("dateFrom") dateFrom?:string, @Query("dateTo") dateTo?:string, @Query("page") page?:string) {
    return this.payableService.findAll({tenantId,farmId,status,dateFrom,dateTo,page:page?Number(page):1});
  }
  @Get(":id") findOne(@Param("id") id:string, @Query("tenantId") tenantId?:string) { return this.payableService.findOne(id,tenantId); }
  @Post() create(@Body() dto:any, @Req() req:any) { return this.payableService.create(dto,req.user?.id); }
  @Put(":id") update(@Param("id") id:string, @Body() dto:any, @Query("tenantId") tenantId?:string) { return this.payableService.update(id,dto,tenantId); }
  @Patch(":id/pay") pay(@Param("id") id:string, @Body() dto:any, @Query("tenantId") tenantId?:string) { return this.payableService.pay(id,dto,tenantId); }
  @Delete(":id") remove(@Param("id") id:string, @Query("tenantId") tenantId?:string) { return this.payableService.remove(id,tenantId); }
}
