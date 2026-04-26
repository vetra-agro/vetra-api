import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { AuditService } from '../audit/audit.service';

export interface PartnerFilters {
  type?:     string;
  status?:   string;
  search?:   string;
  tenantId?: string;
  tags?:     string[];
  page?:     number;
  limit?:    number;
}

@Injectable()
export class PartnersService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Listar parceiros ─────────────────────────────────────────────────────
  async findAll(filters: PartnerFilters = {}) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let query = this.db
      .from('partners_summary')
      .select('*', { count: 'exact' })
      .order('name')
      .range(from, from + limit - 1);

    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.status)   query = query.eq('status', filters.status);
    if (filters.type)     query = query.contains('types', [filters.type]);
    if (filters.search)   query = query.or(
      `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,document.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      data,
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  // ── Buscar por ID ────────────────────────────────────────────────────────
  async findOne(id: string) {
    const { data: partner, error } = await this.db
      .from('partners_summary')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !partner) throw new NotFoundException('Parceiro não encontrado');

    const { data: contacts } = await this.db
      .from('partner_contacts')
      .select('*')
      .eq('partner_id', id)
      .order('is_primary', { ascending: false });

    return { ...partner, contacts: contacts ?? [] };
  }

  // ── Criar parceiro ───────────────────────────────────────────────────────
  async create(dto: CreatePartnerDto, userId?: string) {
    // Verifica documento duplicado
    if (dto.document) {
      const { data: existing } = await this.db
        .from('partners')
        .select('id')
        .eq('document', dto.document.replace(/\D/g, ''))
        .maybeSingle();
      if (existing) throw new ConflictException('Documento já cadastrado');
    }

    const { data, error } = await this.db
      .from('partners')
      .insert({
        types:          dto.types,
        person_type:    dto.personType,
        name:           dto.name,
        trade_name:     dto.tradeName,
        document:       dto.document?.replace(/\D/g, ''),
        state_reg:      dto.stateReg,
        email:          dto.email,
        phone:          dto.phone,
        phone2:         dto.phone2,
        website:        dto.website,
        contact_name:   dto.contactName,
        zip_code:       dto.zipCode,
        street:         dto.street,
        number:         dto.number,
        complement:     dto.complement,
        neighborhood:   dto.neighborhood,
        city:           dto.city,
        state:          dto.state,
        bank_name:      dto.bankName,
        bank_agency:    dto.bankAgency,
        bank_account:   dto.bankAccount,
        bank_pix_key:   dto.bankPixKey,
        antt_code:      dto.anttCode,
        vehicle_types:  dto.vehicleTypes,
        farm_ids:       dto.farmIds,
        sharecrop_pct:  dto.sharecropPct,
        bank_code:      dto.bankCode,
        swift_code:     dto.swiftCode,
        notes:          dto.notes,
        tags:           dto.tags ?? [],
        tenant_id:      dto.tenantId,
        created_by:     userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: dto.tenantId,
      eventType: 'record_created',
      module: 'partners',
      entity: 'partner',
      entityId: data.id,
      entityLabel: data.name,
      description: 'Parceiro criado',
      newValues: dto as any,
      success: true,
    });

    return data;
  }

  // ── Atualizar parceiro ───────────────────────────────────────────────────
  async update(id: string, dto: UpdatePartnerDto, userId?: string) {
    const previous = await this.findOne(id);
    const updates: any = {};
    const map: Record<string, string> = {
      types:'types', personType:'person_type', name:'name',
      tradeName:'trade_name', stateReg:'state_reg',
      email:'email', phone:'phone', phone2:'phone2',
      website:'website', contactName:'contact_name',
      zipCode:'zip_code', street:'street', number:'number',
      complement:'complement', neighborhood:'neighborhood',
      city:'city', state:'state',
      bankName:'bank_name', bankAgency:'bank_agency',
      bankAccount:'bank_account', bankPixKey:'bank_pix_key',
      anttCode:'antt_code', vehicleTypes:'vehicle_types',
      farmIds:'farm_ids', sharecropPct:'sharecrop_pct',
      bankCode:'bank_code', swiftCode:'swift_code',
      notes:'notes', tags:'tags', status:'status',
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }

    const { data, error } = await this.db
      .from('partners').update(updates).eq('id', id).select().single();
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: data.tenant_id,
      eventType: 'record_updated',
      module: 'partners',
      entity: 'partner',
      entityId: id,
      entityLabel: data.name,
      description: 'Parceiro atualizado',
      oldValues: previous,
      newValues: updates,
      success: true,
    });

    return data;
  }

  // ── Ativar / inativar / bloquear ─────────────────────────────────────────
  async setStatus(id: string, status: 'active' | 'inactive' | 'blocked', userId?: string) {
    const previous = await this.findOne(id);
    const { error } = await this.db
      .from('partners').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: previous.tenant_id,
      eventType: 'record_updated',
      module: 'partners',
      entity: 'partner',
      entityId: id,
      entityLabel: previous.name,
      description: 'Status do parceiro atualizado',
      oldValues: { status: previous.status },
      newValues: { status },
      success: true,
    });

    return { id, status };
  }

  // ── Remover parceiro ─────────────────────────────────────────────────────
  async remove(id: string, userId?: string) {
    const previous = await this.findOne(id);
    const { error } = await this.db.from('partners').delete().eq('id', id);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: previous.tenant_id,
      eventType: 'record_deleted',
      module: 'partners',
      entity: 'partner',
      entityId: id,
      entityLabel: previous.name,
      description: 'Parceiro removido',
      oldValues: previous,
      success: true,
    });

    return { message: 'Parceiro removido com sucesso' };
  }

  // ── Contatos ─────────────────────────────────────────────────────────────
  async addContact(partnerId: string, dto: CreateContactDto, userId?: string) {
    const partner = await this.findOne(partnerId);
    const { data, error } = await this.db
      .from('partner_contacts')
      .insert({ partner_id: partnerId, ...dto })
      .select().single();
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: partner.tenant_id,
      eventType: 'record_created',
      module: 'partners',
      entity: 'partner_contact',
      entityId: data.id,
      entityLabel: data.name,
      description: 'Contato de parceiro adicionado',
      metadata: { partnerId },
      newValues: dto as any,
      success: true,
    });

    return data;
  }

  async removeContact(partnerId: string, contactId: string, userId?: string) {
    const partner = await this.findOne(partnerId);

    const { error } = await this.db
      .from('partner_contacts')
      .delete()
      .eq('id', contactId)
      .eq('partner_id', partnerId);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId: partner.tenant_id,
      eventType: 'record_deleted',
      module: 'partners',
      entity: 'partner_contact',
      entityId: contactId,
      description: 'Contato de parceiro removido',
      metadata: { partnerId },
      success: true,
    });

    return { message: 'Contato removido' };
  }

  // ── Stats gerais ──────────────────────────────────────────────────────────
  async getStats(tenantId?: string) {
    let query = this.db.from('partners').select('types, status, person_type');
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data } = await query;
    const all = data ?? [];

    const byType: Record<string, number> = {};
    for (const p of all) {
      for (const t of (p.types ?? [])) {
        byType[t] = (byType[t] ?? 0) + 1;
      }
    }

    return {
      total:    all.length,
      active:   all.filter((p: any) => p.status === 'active').length,
      inactive: all.filter((p: any) => p.status === 'inactive').length,
      blocked:  all.filter((p: any) => p.status === 'blocked').length,
      legal:    all.filter((p: any) => p.person_type === 'legal').length,
      natural:  all.filter((p: any) => p.person_type === 'natural').length,
      byType,
    };
  }
}
