import { Controller, Get, Post, Put, Delete, Param, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FarmsService } from './farms.service';
import { CreateFarmDto } from './dto/create-farm.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';

@ApiTags('farms')
@ApiBearerAuth()
@Controller('farms')
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar fazenda' })
  create(@Req() req: any, @Body() dto: CreateFarmDto) {
    return this.farmsService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar fazendas do usuário' })
  findAll(@Req() req: any) {
    return this.farmsService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar fazenda por ID' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.farmsService.findOne(id, req.user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar fazenda' })
  update(@Param('id') id: string, @Req() req: any, @Body() dto: UpdateFarmDto) {
    return this.farmsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover fazenda' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.farmsService.remove(id, req.user.id);
  }
}
