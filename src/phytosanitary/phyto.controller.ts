import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { PhytoService } from "./phyto.service";
import { CreatePhytoDto } from "./dto/create-phyto.dto";
import { UpdatePhytoDto } from "./dto/update-phyto.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("phytosanitary")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/phytosanitary")
export class PhytoController {
  constructor(private readonly phytoService: PhytoService) {}

  @Get("stats")
  @ApiQuery({ name: "farmId",   required: true })
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "seasonId", required: false })
  getStats(
    @Query("farmId")   farmId:    string,
    @Query("tenantId") tenantId?: string,
    @Query("seasonId") seasonId?: string,
  ) { return this.phytoService.getStats(farmId, tenantId, seasonId); }

  @Get()
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "farmId",   required: false })
  @ApiQuery({ name: "seasonId", required: false })
  @ApiQuery({ name: "dateFrom", required: false })
  @ApiQuery({ name: "dateTo",   required: false })
  @ApiQuery({ name: "page",     required: false })
  findAll(
    @Query("tenantId") tenantId?: string,
    @Query("farmId")   farmId?:   string,
    @Query("seasonId") seasonId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo")   dateTo?:   string,
    @Query("page")     page?:     string,
  ) {
    return this.phytoService.findAll({ tenantId, farmId, seasonId, dateFrom, dateTo,
      page: page ? Number(page) : 1 });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.phytoService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: CreatePhytoDto, @Req() req: any) {
    return this.phytoService.create(dto, req.user?.id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdatePhytoDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.phytoService.update(id, dto, tenantId); }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.phytoService.remove(id, tenantId);
  }
}
