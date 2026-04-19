import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FieldsService } from './fields.service';
import { CreateFieldDto } from './dto/create-field.dto';
import { UpdateFieldDto } from './dto/update-field.dto';

@ApiTags('fields')
@ApiBearerAuth()
@Controller('fields')
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar talhão' })
  create(@Body() dto: CreateFieldDto) {
    return this.fieldsService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'farmId', required: true })
  @ApiOperation({ summary: 'Listar talhões por fazenda' })
  findByFarm(@Query('farmId') farmId: string) {
    return this.fieldsService.findByFarm(farmId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar talhão por ID' })
  findOne(@Param('id') id: string) {
    return this.fieldsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar talhão' })
  update(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.fieldsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover talhão' })
  remove(@Param('id') id: string) {
    return this.fieldsService.remove(id);
  }
}
