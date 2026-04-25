import {
  Controller, Get, Param, Query,
  Res, UseGuards, ParseBoolPipe, ParseIntPipe, Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('stats')
  @ApiOperation({ summary: 'KPIs de auditoria (24h e 30 dias)' })
  @ApiQuery({ name: 'tenantId', required: false })
  getStats(@Query('tenantId') tenantId?: string) {
    return this.auditService.getStats(tenantId);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Listar logs com filtros e paginação' })
  @ApiQuery({ name: 'module',    required: false })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'userId',    required: false })
  @ApiQuery({ name: 'tenantId',  required: false })
  @ApiQuery({ name: 'entity',    required: false })
  @ApiQuery({ name: 'success',   required: false })
  @ApiQuery({ name: 'dateFrom',  required: false })
  @ApiQuery({ name: 'dateTo',    required: false })
  @ApiQuery({ name: 'search',    required: false })
  @ApiQuery({ name: 'page',      required: false })
  @ApiQuery({ name: 'limit',     required: false })
  findAll(
    @Query('module')    module?:    string,
    @Query('eventType') eventType?: string,
    @Query('userId')    userId?:    string,
    @Query('tenantId')  tenantId?:  string,
    @Query('entity')    entity?:    string,
    @Query('success')   success?:   string,
    @Query('dateFrom')  dateFrom?:  string,
    @Query('dateTo')    dateTo?:    string,
    @Query('search')    search?:    string,
    @Query('page')      page?:      string,
    @Query('limit')     limit?:     string,
  ) {
    return this.auditService.findAll({
      module, eventType, userId, tenantId, entity, search,
      success:  success  != null ? success === 'true' : undefined,
      dateFrom, dateTo,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('logs/:id')
  @ApiOperation({ summary: 'Detalhe de um log' })
  findOne(@Param('id') id: string) {
    return this.auditService.findOne(id);
  }

  @Get('access')
  @ApiOperation({ summary: 'Logs de acesso (login, logout, falhas)' })
  @ApiQuery({ name: 'userId',   required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo',   required: false })
  @ApiQuery({ name: 'success',  required: false })
  getAccessLogs(
    @Query('userId')   userId?:  string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo')   dateTo?:   string,
    @Query('success')  success?:  string,
  ) {
    return this.auditService.getAccessLogs({
      userId, dateFrom, dateTo,
      success: success != null ? success === 'true' : undefined,
    });
  }

  @Get('activity')
  @ApiOperation({ summary: 'Resumo de atividade por usuário (30 dias)' })
  @ApiQuery({ name: 'tenantId', required: false })
  getUserActivity(@Query('tenantId') tenantId?: string) {
    return this.auditService.getUserActivity(tenantId);
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Exportar logs em CSV' })
  async exportCsv(
    @Res() res: Response,
    @Query('module')    module?:    string,
    @Query('eventType') eventType?: string,
    @Query('dateFrom')  dateFrom?:  string,
    @Query('dateTo')    dateTo?:    string,
  ) {
    const csv = await this.auditService.exportCsv({ module, eventType, dateFrom, dateTo });
    const filename = `vetra-audit-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM para Excel reconhecer UTF-8
  }
}
