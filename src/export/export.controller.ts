import {
  Controller, Get, Post, Put, Patch,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ExportService } from "./export.service";

@ApiTags("export") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("export")
export class ExportController {
  constructor(private readonly svc: ExportService) {}

  @Get("stats") getStats(@Query("tenantId") t: string) { return this.svc.getStats(t); }

  // Contratos
  @Get("contracts") findAllContracts(@Query("tenantId") t: string,
    @Query("status") s?: string, @Query("seasonId") sid?: string) {
    return this.svc.findAllContracts(t, s, sid);
  }
  @Post("contracts") upsertContract(@Body() dto: any, @Req() req: any) {
    return this.svc.upsertContract(dto, req.user?.id);
  }
  @Patch("contracts/:id/ship") registerShipment(@Param("id") id: string, @Body() dto: any) {
    return this.svc.registerShipment(id, dto);
  }

  // Documentos
  @Get("docs") findAllDocs(@Query("tenantId") t: string,
    @Query("contractId") c?: string, @Query("docType") dt?: string) {
    return this.svc.findAllDocs(t, c, dt);
  }
  @Post("docs") upsertDoc(@Body() dto: any) { return this.svc.upsertDoc(dto); }

  // Câmbio
  @Get("forex") findAllForex(@Query("tenantId") t: string, @Query("status") s?: string) {
    return this.svc.findAllForex(t, s);
  }
  @Post("forex") upsertForex(@Body() dto: any) { return this.svc.upsertForex(dto); }

  // Embarques
  @Get("shipments") findAllShipments(@Query("tenantId") t: string,
    @Query("status") s?: string, @Query("contractId") c?: string) {
    return this.svc.findAllShipments(t, s, c);
  }
  @Post("shipments") upsertShipment(@Body() dto: any) { return this.svc.upsertShipment(dto); }
  @Patch("shipments/:id/advance") advanceStatus(@Param("id") id: string, @Body("next") next: string) {
    return this.svc.advanceShipmentStatus(id, next);
  }
}
