import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InputsService } from './inputs.service';
import { CreateInputDto } from './dto/create-input.dto';

@ApiTags('inputs')
@ApiBearerAuth()
@Controller('inputs')
export class InputsController {
  constructor(private readonly inputsService: InputsService) {}

  @Post(':farmId')
  @ApiOperation({ summary: 'Adicionar insumo ao estoque' })
  create(@Param('farmId') farmId: string, @Body() dto: CreateInputDto) {
    return this.inputsService.create(farmId, dto);
  }

  @Get()
  @ApiQuery({ name: 'farmId', required: true })
  @ApiOperation({ summary: 'Listar insumos da fazenda' })
  findByFarm(@Query('farmId') farmId: string) {
    return this.inputsService.findByFarm(farmId);
  }

  @Get('low-stock')
  @ApiQuery({ name: 'farmId', required: true })
  @ApiOperation({ summary: 'Insumos com estoque abaixo do mínimo' })
  findLowStock(@Query('farmId') farmId: string) {
    return this.inputsService.findLowStock(farmId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover insumo' })
  remove(@Param('id') id: string) {
    return this.inputsService.remove(id);
  }
}
