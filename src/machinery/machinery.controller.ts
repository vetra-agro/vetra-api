import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { MachineryService } from "./machinery.service";
import { CreateMachineryDto } from "./dto/create-machinery.dto";
import { UpdateMachineryDto } from "./dto/update-machinery.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("machinery")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/machinery")
export class MachineryController {
  constructor(private readonly machineryService: MachineryService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs de maquinário do tenant" })
  @ApiQuery({ name: "tenantId", required: true })
  getStats(@Query("tenantId") tenantId: string) {
    return this.machineryService.getStats(tenantId);
  }

  @Get()
  @ApiOperation({ summary: "Listar maquinário" })
  @ApiQuery({ name: "tenantId", required: true })
  @ApiQuery({ name: "farmId",   required: false })
  @ApiQuery({ name: "status",   required: false })
  @ApiQuery({ name: "type",     required: false })
  @ApiQuery({ name: "search",   required: false })
  findAll(
    @Query("tenantId") tenantId: string,
    @Query("farmId")   farmId?:  string,
    @Query("status")   status?:  string,
    @Query("type")     type?:    string,
    @Query("search")   search?:  string,
  ) { return this.machineryService.findAll(tenantId, { farmId, status, type, search }); }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de um equipamento" })
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.machineryService.findOne(id, tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Cadastrar equipamento" })
  create(@Body() dto: CreateMachineryDto, @Req() req: any) {
    return this.machineryService.create(dto, req.user?.id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar equipamento" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateMachineryDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.machineryService.update(id, dto, tenantId); }

  @Patch(":id/meters")
  @ApiOperation({ summary: "Atualizar horímetro / odômetro" })
  updateMeters(
    @Param("id") id: string,
    @Body() body: { hourmeterCurrent?: number; odometerCurrentKm?: number },
    @Query("tenantId") tenantId?: string,
  ) { return this.machineryService.updateMeters(id, { ...body, tenantId }); }

  @Patch(":id/status")
  @ApiOperation({ summary: "Atualizar status do equipamento" })
  setStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Query("tenantId") tenantId?: string,
  ) { return this.machineryService.setStatus(id, status, tenantId); }

  @Delete(":id")
  @ApiOperation({ summary: "Remover equipamento" })
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.machineryService.remove(id, tenantId);
  }
}
