import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PartnersService } from './partners.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('partners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/partners')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get('stats')
  @ApiOperation({ summary: 'KPIs de parceiros' })
  @ApiQuery({ name: 'tenantId', required: false })
  getStats(@Query('tenantId') tenantId?: string) {
    return this.partnersService.getStats(tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar parceiros com filtros e paginação' })
  @ApiQuery({ name: 'type',     required: false })
  @ApiQuery({ name: 'status',   required: false })
  @ApiQuery({ name: 'search',   required: false })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'page',     required: false })
  @ApiQuery({ name: 'limit',    required: false })
  findAll(
    @Query('type')     type?:     string,
    @Query('status')   status?:   string,
    @Query('search')   search?:   string,
    @Query('tenantId') tenantId?: string,
    @Query('page')     page?:     string,
    @Query('limit')    limit?:    string,
  ) {
    return this.partnersService.findAll({
      type, status, search, tenantId,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um parceiro com contatos' })
  findOne(@Param('id') id: string) {
    return this.partnersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar parceiro' })
  create(@Body() dto: CreatePartnerDto, @Req() req: any) {
    return this.partnersService.create(dto, req.user?.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar parceiro' })
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto, @Req() req: any) {
    return this.partnersService.update(id, dto, req.user?.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Atualizar status (active/inactive/blocked)' })
  setStatus(
    @Param('id') id: string,
    @Body('status') status: 'active' | 'inactive' | 'blocked',
    @Req() req: any,
  ) { return this.partnersService.setStatus(id, status, req.user?.id); }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover parceiro' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.partnersService.remove(id, req.user?.id);
  }

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Adicionar contato ao parceiro' })
  addContact(@Param('id') id: string, @Body() dto: CreateContactDto, @Req() req: any) {
    return this.partnersService.addContact(id, dto, req.user?.id);
  }

  @Delete(':id/contacts/:contactId')
  @ApiOperation({ summary: 'Remover contato do parceiro' })
  removeContact(@Param('id') id: string, @Param('contactId') contactId: string, @Req() req: any) {
    return this.partnersService.removeContact(id, contactId, req.user?.id);
  }
}
