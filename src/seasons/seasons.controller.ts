import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { SeasonsService } from "./seasons.service";
import { CreateSeasonDto } from "./dto/create-season.dto";
import { UpdateSeasonDto } from "./dto/update-season.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("seasons")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/seasons")
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs de safras do tenant" })
  @ApiQuery({ name: "tenantId", required: true })
  getStats(@Query("tenantId") tenantId: string) {
    return this.seasonsService.getStats(tenantId);
  }

  @Get()
  @ApiOperation({ summary: "Listar safras" })
  @ApiQuery({ name: "farmId",   required: false })
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "status",   required: false })
  findAll(
    @Query("farmId")   farmId?:   string,
    @Query("tenantId") tenantId?: string,
    @Query("status")   status?:   string,
  ) {
    if (farmId) return this.seasonsService.findAll(farmId, tenantId, status);
    return this.seasonsService.findAllByTenant(tenantId!, status);
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de uma safra" })
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.seasonsService.findOne(id, tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Criar safra" })
  create(@Body() dto: CreateSeasonDto, @Req() req: any) {
    return this.seasonsService.create(dto, req.user?.id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar safra" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateSeasonDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.seasonsService.update(id, dto, tenantId); }

  @Patch(":id/status")
  @ApiOperation({ summary: "Avançar status da safra" })
  setStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Query("tenantId") tenantId?: string,
  ) { return this.seasonsService.setStatus(id, status, tenantId); }

  @Delete(":id")
  @ApiOperation({ summary: "Remover safra" })
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.seasonsService.remove(id, tenantId);
  }
}
