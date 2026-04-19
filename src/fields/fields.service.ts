import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateFieldDto } from './dto/create-field.dto';
import { UpdateFieldDto } from './dto/update-field.dto';

@Injectable()
export class FieldsService {
  constructor(private supabase: SupabaseProvider) {}

  async create(dto: CreateFieldDto) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .insert(dto)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findByFarm(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .select('*')
      .eq('farm_id', farmId)
      .order('name');
    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Talhão não encontrado');
    return data;
  }

  async update(id: string, dto: UpdateFieldDto) {
    const { data, error } = await this.supabase.getClient()
      .from('fields')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Talhão não encontrado');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.supabase.getClient()
      .from('fields')
      .delete()
      .eq('id', id);
    if (error) throw new NotFoundException('Talhão não encontrado');
    return { message: 'Talhão removido com sucesso' };
  }
}
