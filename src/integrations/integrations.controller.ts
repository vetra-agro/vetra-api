import { Controller, Get, Put, Post, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { IntegrationsService } from "./integrations.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("integrations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: "Listar integrações com status e campos" })
  @ApiQuery({ name: "tenantId", required: true })
  getAll(@Query("tenantId") tenantId: string) {
    return this.integrationsService.getAll(tenantId);
  }

  @Put(":key")
  @ApiOperation({ summary: "Salvar campos de uma integração" })
  @ApiQuery({ name: "tenantId", required: true })
  save(
    @Param("key") key: string,
    @Query("tenantId") tenantId: string,
    @Body() values: Record<string, string>,
    @Req() req: any,
  ) {
    return this.integrationsService.saveIntegration(tenantId, key, values, req.user?.id);
  }

  @Post(":key/test")
  @ApiOperation({ summary: "Testar conexão de uma integração" })
  @ApiQuery({ name: "tenantId", required: true })
  test(
    @Param("key") key: string,
    @Query("tenantId") tenantId: string,
    @Req() req: any,
  ) {
    return this.integrationsService.testIntegration(tenantId, key, req.user?.id);
  }
}
