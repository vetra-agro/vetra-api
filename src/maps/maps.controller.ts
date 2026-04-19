import { Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MapsService } from './maps.service';

@ApiTags('maps')
@ApiBearerAuth()
@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Get('fields/geojson')
  @ApiQuery({ name: 'farmId', required: true })
  @ApiOperation({ summary: 'Talhões como GeoJSON FeatureCollection' })
  getFieldsGeoJSON(@Query('farmId') farmId: string) {
    return this.mapsService.getFieldsGeoJSON(farmId);
  }

  @Put('fields/:id/geometry')
  @ApiOperation({ summary: 'Atualizar geometria (polígono) do talhão' })
  updateGeometry(@Param('id') id: string, @Body() body: { geometry: Record<string, any> }) {
    return this.mapsService.updateFieldGeometry(id, body.geometry);
  }
}
