import { Injectable } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';

@Injectable()
export class MapsService {
  constructor(private supabase: SupabaseProvider) {}

  /**
   * Retorna os talhões de uma fazenda como GeoJSON FeatureCollection
   * Requer PostGIS e a função ST_AsGeoJSON no Supabase
   */
  async getFieldsGeoJSON(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .select('id, name, crop, area_ha, current_season, geometry')
      .eq('farm_id', farmId)
      .not('geometry', 'is', null);

    if (error) throw new Error(error.message);

    return {
      type: 'FeatureCollection',
      features: data.map(field => ({
        type: 'Feature',
        id: field.id,
        properties: {
          name: field.name,
          crop: field.crop,
          area_ha: field.area_ha,
          current_season: field.current_season,
        },
        geometry: field.geometry,
      })),
    };
  }

  async updateFieldGeometry(fieldId: string, geometry: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .update({ geometry })
      .eq('id', fieldId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
