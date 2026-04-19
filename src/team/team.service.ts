import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateWorkerDto } from './dto/create-worker.dto';

@Injectable()
export class TeamService {
  constructor(private supabase: SupabaseProvider) {}

  async create(farmId: string, dto: CreateWorkerDto) {
    const { data, error } = await this.supabase.getClient()
      .from('workers')
      .insert({ ...dto, farm_id: farmId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findByFarm(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('workers')
      .select('*')
      .eq('farm_id', farmId)
      .order('name');
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string) {
    const { error } = await this.supabase.getClient()
      .from('workers')
      .delete()
      .eq('id', id);
    if (error) throw new NotFoundException('Funcionário não encontrado');
    return { message: 'Funcionário removido' };
  }
}
