import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FinancialService } from './financial.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@ApiTags('financial')
@ApiBearerAuth()
@Controller('financial')
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Post(':farmId/transactions')
  @ApiOperation({ summary: 'Lançar transação financeira' })
  create(@Param('farmId') farmId: string, @Body() dto: CreateTransactionDto) {
    return this.financialService.create(farmId, dto);
  }

  @Get(':farmId/transactions')
  @ApiOperation({ summary: 'Listar transações' })
  @ApiQuery({ name: 'from', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2024-12-31' })
  findByFarm(
    @Param('farmId') farmId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financialService.findByFarm(farmId, from, to);
  }

  @Get(':farmId/summary')
  @ApiOperation({ summary: 'Resumo financeiro da fazenda' })
  getSummary(@Param('farmId') farmId: string) {
    return this.financialService.getSummary(farmId);
  }
}
