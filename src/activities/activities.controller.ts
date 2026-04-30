import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { ActivitiesService } from "./activities.service";
import { CreateActivityDto } from "./dto/create-activity.dto";
import { UpdateActivityDto } from "./dto/update-activity.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("activities")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/activities")
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs de atividades de uma fazenda" })
  @ApiQuery({ name: "farmId",   required: true })
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "dateFrom", required: false })
  @ApiQuery({ name: "dateTo",   required: false })
  getStats(
    @Query("farmId")   farmId:    string,
    @Query("tenantId") tenantId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo")   dateTo?:   string,
  ) { return this.activitiesService.getStats(farmId, tenantId, dateFrom, dateTo); }

  @Get()
  @ApiOperation({ summary: "Listar apontamentos com filtros e paginação" })
  @ApiQuery({ name: "tenantId",   required: false })
  @ApiQuery({ name: "farmId",     required: false })
  @ApiQuery({ name: "seasonId",   required: false })
  @ApiQuery({ name: "type",       required: false })
  @ApiQuery({ name: "status",     required: false })
  @ApiQuery({ name: "operatorId", required: false })
  @ApiQuery({ name: "dateFrom",   required: false })
  @ApiQuery({ name: "dateTo",     required: false })
  @ApiQuery({ name: "page",       required: false })
  @ApiQuery({ name: "limit",      required: false })
  findAll(
    @Query("tenantId")   tenantId?:   string,
    @Query("farmId")     farmId?:     string,
    @Query("seasonId")   seasonId?:   string,
    @Query("type")       type?:       string,
    @Query("status")     status?:     string,
    @Query("operatorId") operatorId?: string,
    @Query("dateFrom")   dateFrom?:   string,
    @Query("dateTo")     dateTo?:     string,
    @Query("page")       page?:       string,
    @Query("limit")      limit?:      string,
  ) {
    return this.activitiesService.findAll({
      tenantId, farmId, seasonId, type, status, operatorId, dateFrom, dateTo,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de um apontamento" })
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.activitiesService.findOne(id, tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Criar apontamento" })
  create(@Body() dto: CreateActivityDto, @Req() req: any) {
    return this.activitiesService.create(dto, req.user?.id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar apontamento" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateActivityDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.activitiesService.update(id, dto, tenantId); }

  @Delete(":id")
  @ApiOperation({ summary: "Remover apontamento" })
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.activitiesService.remove(id, tenantId);
  }
}
