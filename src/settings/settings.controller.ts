import {
  Controller, Get, Put, Post, Delete,
  Param, Body, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar todas as configurações agrupadas por categoria' })
  @ApiQuery({ name: 'tenantId', required: true })
  getAll(@Query('tenantId') tenantId: string) {
    return this.settingsService.getAll(tenantId);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Buscar valor de uma configuração' })
  @ApiQuery({ name: 'tenantId', required: true })
  get(
    @Param('key') key: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.settingsService.get(tenantId, key);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Atualizar uma configuração' })
  @ApiQuery({ name: 'tenantId', required: true })
  set(
    @Param('key') key: string,
    @Query('tenantId') tenantId: string,
    @Body('value') value: string,
    @Req() req: any,
  ) {
    return this.settingsService.set(tenantId, key, value, req.user?.id);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Atualizar múltiplas configurações de uma vez' })
  @ApiQuery({ name: 'tenantId', required: true })
  setBatch(
    @Query('tenantId') tenantId: string,
    @Body() body: { entries: Array<{ key: string; value: string }> },
    @Req() req: any,
  ) {
    return this.settingsService.setBatch(tenantId, body.entries, req.user?.id);
  }

  @Delete(':key/reset')
  @ApiOperation({ summary: 'Resetar configuração para o valor padrão' })
  @ApiQuery({ name: 'tenantId', required: true })
  reset(
    @Param('key') key: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.settingsService.reset(tenantId, key);
  }

  @Delete('reset-all')
  @ApiOperation({ summary: 'Resetar todas as configurações para os padrões' })
  @ApiQuery({ name: 'tenantId', required: true })
  resetAll(@Query('tenantId') tenantId: string) {
    return this.settingsService.resetAll(tenantId);
  }

  @Post('test-smtp')
  @ApiOperation({ summary: 'Testar conexão SMTP' })
  @ApiQuery({ name: 'tenantId', required: true })
  testSmtp(@Query('tenantId') tenantId: string) {
    return this.settingsService.testSmtp(tenantId);
  }
}
