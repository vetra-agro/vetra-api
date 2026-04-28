import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { FarmsService } from "./farms.service";
import { CreateFarmDto } from "./dto/create-farm.dto";
import { UpdateFarmDto } from "./dto/update-farm.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("farms")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/farms")
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs de fazendas do tenant" })
  @ApiQuery({ name: "tenantId", required: true })
  getStats(@Query("tenantId") tenantId: string) {
    return this.farmsService.getStats(tenantId);
  }

  @Get()
  @ApiOperation({ summary: "Listar fazendas" })
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "status",   required: false })
  @ApiQuery({ name: "state",    required: false })
  @ApiQuery({ name: "biome",    required: false })
  @ApiQuery({ name: "search",   required: false })
  findAll(
    @Query("tenantId") tenantId?: string,
    @Query("status")   status?:   string,
    @Query("state")    state?:    string,
    @Query("biome")    biome?:    string,
    @Query("search")   search?:   string,
  ) {
    return this.farmsService.findAll({ tenantId, status, state, biome, search });
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de uma fazenda" })
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.farmsService.findOne(id, tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Criar fazenda" })
  create(@Body() dto: CreateFarmDto, @Req() req: any) {
    return this.farmsService.create(dto, req.user?.id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar fazenda" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFarmDto,
    @Query("tenantId") tenantId?: string,
  ) {
    return this.farmsService.update(id, dto, tenantId);
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Atualizar status da fazenda" })
  setStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Query("tenantId") tenantId?: string,
  ) {
    return this.farmsService.setStatus(id, status, tenantId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remover fazenda" })
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.farmsService.remove(id, tenantId);
  }
}
