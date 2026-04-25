import {
  Controller, Get, Post, Put, Patch,
  Param, Body, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LicensesService } from './licenses.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('licenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Listar planos disponíveis' })
  getPlans() { return this.licensesService.getPlans(); }

  @Get('stats')
  @ApiOperation({ summary: 'KPIs gerais de licenças' })
  getStats() { return this.licensesService.getStats(); }

  @Get('expiring-soon')
  @ApiOperation({ summary: 'Licenças vencendo nos próximos 30 dias' })
  getExpiringSoon() { return this.licensesService.getExpiringSoon(); }

  @Get('tenants')
  @ApiOperation({ summary: 'Listar todos os tenants com licença' })
  @ApiQuery({ name: 'search', required: false })
  getTenants(@Query('search') search?: string) {
    return this.licensesService.getTenants(search);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Detalhe de um tenant' })
  getTenant(@Param('id') id: string) {
    return this.licensesService.getTenant(id);
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Criar tenant e licença inicial (trial)' })
  createTenant(@Body() dto: CreateTenantDto, @Req() req: any) {
    return this.licensesService.createTenant(dto, req.user?.id);
  }

  @Get('tenants/:id/history')
  @ApiOperation({ summary: 'Histórico de mudanças da licença do tenant' })
  getHistory(@Param('id') id: string) {
    return this.licensesService.getHistory(id);
  }

  @Put('tenants/:id')
  @ApiOperation({ summary: 'Atualizar licença do tenant' })
  updateLicense(
    @Param('id') id: string,
    @Body() dto: UpdateLicenseDto,
    @Req() req: any,
  ) { return this.licensesService.updateLicense(id, dto, req.user?.id); }

  @Patch('tenants/:id/suspend')
  @ApiOperation({ summary: 'Suspender licença' })
  suspend(@Param('id') id: string, @Req() req: any) {
    return this.licensesService.suspendLicense(id, req.user?.id);
  }

  @Patch('tenants/:id/reactivate')
  @ApiOperation({ summary: 'Reativar licença suspensa' })
  reactivate(@Param('id') id: string, @Req() req: any) {
    return this.licensesService.reactivateLicense(id, req.user?.id);
  }

  @Patch('tenants/:id/renew')
  @ApiOperation({ summary: 'Renovar licença por N meses' })
  renew(
    @Param('id') id: string,
    @Body('months') months: number,
    @Req() req: any,
  ) { return this.licensesService.renewLicense(id, months, req.user?.id); }
}
