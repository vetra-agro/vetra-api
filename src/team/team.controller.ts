import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { CreateWorkerDto } from './dto/create-worker.dto';

@ApiTags('team')
@ApiBearerAuth()
@Controller('team')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post(':farmId')
  @ApiOperation({ summary: 'Adicionar funcionário' })
  create(@Param('farmId') farmId: string, @Body() dto: CreateWorkerDto) {
    return this.teamService.create(farmId, dto);
  }

  @Get()
  @ApiQuery({ name: 'farmId', required: true })
  @ApiOperation({ summary: 'Listar equipe da fazenda' })
  findByFarm(@Query('farmId') farmId: string) {
    return this.teamService.findByFarm(farmId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover funcionário' })
  remove(@Param('id') id: string) {
    return this.teamService.remove(id);
  }
}
