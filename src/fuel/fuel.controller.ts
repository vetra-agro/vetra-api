import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { FuelService } from "./fuel.service";
import { CreateFuelSupplyDto } from "./dto/create-fuel-supply.dto";
import { UpdateFuelSupplyDto } from "./dto/update-fuel-supply.dto";
import { CreateFuelTankDto } from "./dto/create-fuel-tank.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("fuel")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/fuel")
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get("stats")
  @ApiQuery({ name: "farmId",   required: true })
  @ApiQuery({ name: "tenantId", required: false })
  @ApiQuery({ name: "dateFrom", required: false })
  @ApiQuery({ name: "dateTo",   required: false })
  getStats(
    @Query("farmId")   farmId:    string,
    @Query("tenantId") tenantId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo")   dateTo?:   string,
  ) { return this.fuelService.getStats(farmId, tenantId, dateFrom, dateTo); }

  @Get("tanks/:farmId")
  @ApiQuery({ name: "tenantId", required: false })
  getTanks(@Param("farmId") farmId: string, @Query("tenantId") tenantId?: string) {
    return this.fuelService.getTanks(farmId, tenantId);
  }

  @Post("tanks")
  createTank(@Body() dto: CreateFuelTankDto) {
    return this.fuelService.createTank(dto);
  }

  @Get()
  @ApiQuery({ name: "tenantId",    required: false })
  @ApiQuery({ name: "farmId",      required: false })
  @ApiQuery({ name: "machineryId", required: false })
  @ApiQuery({ name: "fuelType",    required: false })
  @ApiQuery({ name: "seasonId",    required: false })
  @ApiQuery({ name: "dateFrom",    required: false })
  @ApiQuery({ name: "dateTo",      required: false })
  @ApiQuery({ name: "page",        required: false })
  findAll(
    @Query("tenantId")    tenantId?:    string,
    @Query("farmId")      farmId?:      string,
    @Query("machineryId") machineryId?: string,
    @Query("fuelType")    fuelType?:    string,
    @Query("seasonId")    seasonId?:    string,
    @Query("dateFrom")    dateFrom?:    string,
    @Query("dateTo")      dateTo?:      string,
    @Query("page")        page?:        string,
  ) {
    return this.fuelService.findAll({
      tenantId, farmId, machineryId, fuelType, seasonId, dateFrom, dateTo,
      page: page ? Number(page) : 1,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fuelService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: CreateFuelSupplyDto, @Req() req: any) {
    return this.fuelService.create(dto, req.user?.id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFuelSupplyDto,
    @Query("tenantId") tenantId?: string,
  ) { return this.fuelService.update(id, dto, tenantId); }

  @Delete(":id")
  remove(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.fuelService.remove(id, tenantId);
  }
}
