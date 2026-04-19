import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateInputDto } from './dto/create-input.dto';

@Injectable()
export class InputsService {
  constructor(private supabase: SupabaseProvider) {}

  async create(farmId: string, dto: CreateInputDto) {
    const { data, error } = await this.supabase.getClient()
      .from('inputs')
      .insert({ ...dto, farm_id: farmId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findByFarm(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('inputs')
      .select('*')
      .eq('farm_id', farmId)
      .order('name');
    if (error) throw new Error(error.message);
    return data;
  }

  async findLowStock(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('inputs')
      .select('*')
      .eq('farm_id', farmId)
      .lt('quantity', 'min_quantity');
    if (error) throw new Error(error.message);
    return data;
  }

  async updateStock(id: string, quantity: number) {
    const { data, error } = await this.supabase.getClient()
      .from('inputs')
      .update({ quantity })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Insumo não encontrado');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.supabase.getClient()
      .from('inputs')
      .delete()
      .eq('id', id);
    if (error) throw new NotFoundException('Insumo não encontrado');
    return { message: 'Insumo removido' };
  }
}
