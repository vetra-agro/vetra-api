import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MaintenanceService } from "./maintenance.service";

@ApiTags("maintenance") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("maintenance")
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Get("kpis")
  getKpis(@Query("tenantId") t: string) { return this.svc.getKpis(t); }

  @Get("machinery")
  getMachinery(@Query("tenantId") t: string) { return this.svc.getMachinery(t); }

  // Planos
  @Get("plans")
  findAllPlans(@Query("tenantId") t: string, @Query("machineryId") m?: string) {
    return this.svc.findAllPlans(t, m);
  }
  @Post("plans") upsertPlan(@Body() dto: any) { return this.svc.upsertPlan(dto); }

  // Agendamentos
  @Get("schedules")
  findAllSchedules(@Query("tenantId") t: string, @Query("status") s?: string,
    @Query("machineryId") m?: string, @Query("dateFrom") df?: string) {
    return this.svc.findAllSchedules(t, { status:s, machineId:m, dateFrom:df });
  }
  @Post("schedules") upsertSchedule(@Body() dto: any) { return this.svc.upsertSchedule(dto); }
  @Patch("schedules/:id/complete")
  completeSchedule(@Param("id") id: string, @Body() dto: any, @Query("tenantId") t: string) {
    return this.svc.completeSchedule(id, { ...dto, tenantId: t });
  }

  // Ordens de Serviço
  @Get("os")
  findAllOS(@Query("tenantId") t: string, @Query("status") s?: string,
    @Query("priority") p?: string, @Query("machineryId") m?: string, @Query("page") pg?: string) {
    return this.svc.findAllWorkOrders(t, { status:s, priority:p, machineId:m, page:pg?+pg:1 });
  }
  @Post("os") createOS(@Body() dto: any, @Req() req: any) {
    return this.svc.createWorkOrder(dto, req.user?.id);
  }
  @Put("os/:id") updateOS(@Param("id") id: string, @Body() dto: any) {
    return this.svc.updateWorkOrder(id, dto);
  }

  // Checklists
  @Get("checklists")
  findAllChecklists(@Query("tenantId") t: string, @Query("machineryId") m?: string) {
    return this.svc.findAllChecklists(t, m);
  }
  @Post("checklists") upsertChecklist(@Body() dto: any) { return this.svc.upsertChecklist(dto); }

  // Histórico
  @Get("history")
  getHistory(@Query("tenantId") t: string, @Query("machineryId") m?: string,
    @Query("dateFrom") df?: string) {
    return this.svc.getHistory(t, m, df);
  }
}
