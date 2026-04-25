import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateFarmDto } from './dto/create-farm.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class FarmsService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  async create(userId: string, dto: CreateFarmDto) {
    const { data, error } = await this.supabase.getClient()
      .from('farms')
      .insert({ ...dto, owner_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      eventType: 'record_created',
      module: 'farm',
      entity: 'farm',
      entityId: data.id,
      entityLabel: data.name,
      description: 'Fazenda criada',
      newValues: dto,
      success: true,
    });

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

    await this.audit?.log({
      userId,
      eventType: 'record_updated',
      module: 'farm',
      entity: 'farm',
      entityId: id,
      entityLabel: data.name,
      description: 'Fazenda atualizada',
      newValues: dto,
      success: true,
    });

    return data;
  }

  async remove(id: string, userId: string) {
    const { error } = await this.supabase.getClient()
      .from('farms')
      .delete()
      .eq('id', id)
      .eq('owner_id', userId);
    if (error) throw new NotFoundException('Fazenda não encontrada');

    await this.audit?.log({
      userId,
      eventType: 'record_deleted',
      module: 'farm',
      entity: 'farm',
      entityId: id,
      description: 'Fazenda removida',
      success: true,
    });

    return { message: 'Fazenda removida com sucesso' };
  }
}
