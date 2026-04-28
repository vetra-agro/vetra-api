import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { FieldsService } from "./fields.service";
import { CreateFieldDto } from "./dto/create-field.dto";
import { UpdateFieldDto } from "./dto/update-field.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("fields")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/fields")
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Get("stats/:farmId")
  @ApiOperation({ summary: "KPIs dos talhões de uma fazenda" })
  getStats(@Param("farmId") farmId: string) {
    return this.fieldsService.getStats(farmId);
  }

  @Get("geojson/:farmId")
  @ApiOperation({ summary: "GeoJSON dos talhões para o MapLibre" })
  @ApiQuery({ name: "tenantId", required: false })
  getGeoJson(
    @Param("farmId") farmId: string,
    @Query("tenantId") tenantId?: string,
  ) { return this.fieldsService.getGeoJson(farmId, tenantId); }

  @Get()
  @ApiOperation({ summary: "Listar talhões de uma fazenda" })
  @ApiQuery({ name: "farmId",   required: true })
  @ApiQuery({ name: "tenantId", required: false })
  findAll(
    @Query("farmId")   farmId: string,
    @Query("tenantId") tenantId?: string,
  ) { return this.fieldsService.findAll(farmId, tenantId); }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de um talhão" })
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldsService.findOne(id, tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Criar talhão" })
  create(@Body() dto: CreateFieldDto, @Req() req: any) {
    return this.fieldsService.create(dto, req.user?.id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar talhão" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFieldDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.fieldsService.update(id, dto, tenantId); }

  @Patch(":id/deactivate")
  @ApiOperation({ summary: "Desativar talhão" })
  deactivate(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldsService.setActive(id, false, tenantId);
  }

  @Patch(":id/activate")
  @ApiOperation({ summary: "Reativar talhão" })
  activate(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldsService.setActive(id, true, tenantId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remover talhão" })
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldsService.remove(id, tenantId);
  }
}
