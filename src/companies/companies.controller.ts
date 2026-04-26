import { Controller, Get, Put, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { CompaniesService } from "./companies.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("companies")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/companies")
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get("stats")
  @ApiOperation({ summary: "KPIs gerais de empresas" })
  getStats() { return this.companiesService.getStats(); }

  @Get()
  @ApiOperation({ summary: "Listar empresas com licença" })
  @ApiQuery({ name: "search", required: false })
  findAll(@Query("search") search?: string) {
    return this.companiesService.findAll(search);
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe da empresa com usuários, fazendas e histórico" })
  findOne(@Param("id") id: string) {
    return this.companiesService.findOne(id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar dados da empresa" })
  update(@Param("id") id: string, @Body() dto: any) {
    return this.companiesService.update(id, dto);
  }
}
