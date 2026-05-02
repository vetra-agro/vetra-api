import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { WeatherService } from "./weather.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("weather")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("farm/weather")
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get("latest")
  @ApiOperation({ summary: "Última leitura salva de todas as fazendas do tenant" })
  @ApiQuery({ name: "tenantId", required: true })
  getLatest(@Query("tenantId") tenantId: string) {
    return this.weatherService.getLatestByTenant(tenantId);
  }

  @Get("current/:farmId")
  @ApiOperation({ summary: "Condições atuais da fazenda (tempo real)" })
  @ApiQuery({ name: "tenantId", required: true })
  getCurrent(
    @Param("farmId")   farmId:   string,
    @Query("tenantId") tenantId: string,
  ) { return this.weatherService.getCurrentWeather(farmId, tenantId); }

  @Get("forecast/:farmId")
  @ApiOperation({ summary: "Previsão 5 dias para a fazenda" })
  @ApiQuery({ name: "tenantId", required: true })
  getForecast(
    @Param("farmId")   farmId:   string,
    @Query("tenantId") tenantId: string,
  ) { return this.weatherService.getForecast(farmId, tenantId); }

  @Get("history/:farmId")
  @ApiOperation({ summary: "Histórico de leituras da fazenda" })
  @ApiQuery({ name: "tenantId", required: true })
  @ApiQuery({ name: "days",     required: false })
  getHistory(
    @Param("farmId")   farmId:   string,
    @Query("tenantId") tenantId: string,
    @Query("days")     days?:    string,
  ) { return this.weatherService.getHistory(farmId, tenantId, days ? Number(days) : 30); }
}
