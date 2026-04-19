import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateFarmDto } from './dto/create-farm.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';

@Injectable()
export class FarmsService {
  constructor(private supabase: SupabaseProvider) {}

  async create(userId: string, dto: CreateFarmDto) {
    const { data, error } = await this.supabase.getClient()
      .from('farms')
      .insert({ ...dto, owner_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findAll(userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('farms')
      .select('*, fields(count)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('farms')
      .select('*, fields(*)')
      .eq('id', id)
      .eq('owner_id', userId)
      .single();
    if (error || !data) throw new NotFoundException('Fazenda não encontrada');
    return data;
  }

  async update(id: string, userId: string, dto: UpdateFarmDto) {
    const { data, error } = await this.supabase.getClient()
      .from('farms')
      .update(dto)
      .eq('id', id)
      .eq('owner_id', userId)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Fazenda não encontrada');
    return data;
  }

  async remove(id: string, userId: string) {
    const { error } = await this.supabase.getClient()
      .from('farms')
      .delete()
      .eq('id', id)
      .eq('owner_id', userId);
    if (error) throw new NotFoundException('Fazenda não encontrada');
    return { message: 'Fazenda removida com sucesso' };
  }
}
