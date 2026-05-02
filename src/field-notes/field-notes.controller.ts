import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { FieldNotesService } from "./field-notes.service";
import { CreateFieldNoteDto } from "./dto/create-field-note.dto";
import { UpdateFieldNoteDto } from "./dto/update-field-note.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("field-notes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/field-notes")
export class FieldNotesController {
  constructor(private readonly fieldNotesService: FieldNotesService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs do caderno de campo" })
  @ApiQuery({ name: "farmId",   required: true })
  @ApiQuery({ name: "tenantId", required: false })
  getStats(
    @Query("farmId")   farmId:    string,
    @Query("tenantId") tenantId?: string,
  ) { return this.fieldNotesService.getStats(farmId, tenantId); }

  @Get()
  @ApiOperation({ summary: "Listar registros do caderno" })
  findAll(
    @Query("tenantId")  tenantId?:  string,
    @Query("farmId")    farmId?:    string,
    @Query("fieldId")   fieldId?:   string,
    @Query("seasonId")  seasonId?:  string,
    @Query("type")      type?:      string,
    @Query("severity")  severity?:  string,
    @Query("resolved")  resolved?:  string,
    @Query("dateFrom")  dateFrom?:  string,
    @Query("dateTo")    dateTo?:    string,
    @Query("page")      page?:      string,
    @Query("limit")     limit?:     string,
  ) {
    return this.fieldNotesService.findAll({
      tenantId, farmId, fieldId, seasonId, type, severity,
      resolved: resolved !== undefined ? resolved === "true" : undefined,
      dateFrom, dateTo,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldNotesService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: CreateFieldNoteDto, @Req() req: any) {
    return this.fieldNotesService.create(dto, req.user?.id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFieldNoteDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.fieldNotesService.update(id, dto, tenantId); }

  @Patch(":id/resolve")
  @ApiOperation({ summary: "Marcar ocorrência como resolvida" })
  resolve(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldNotesService.resolve(id, tenantId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fieldNotesService.remove(id, tenantId);
  }
}
