import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TeamService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  async create(farmId: string, dto: CreateWorkerDto) {
    const { data, error } = await this.supabase.getClient()
      .from('workers')
      .insert({ ...dto, farm_id: farmId })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit?.log({
      eventType: 'record_created',
      module: 'farm',
      entity: 'worker',
      entityId: data.id,
      entityLabel: data.name,
      description: 'Funcionário cadastrado',
      metadata: { farmId },
      newValues: dto,
      success: true,
    });

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

    await this.audit?.log({
      eventType: 'record_deleted',
      module: 'farm',
      entity: 'worker',
      entityId: id,
      description: 'Funcionário removido',
      success: true,
    });

    return { message: 'Funcionário removido' };
  }
}
