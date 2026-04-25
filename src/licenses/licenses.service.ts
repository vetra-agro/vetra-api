import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';

@Injectable()
export class LicensesService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Planos disponíveis ───────────────────────────────────────────────────
  async getPlans() {
    const { data, error } = await this.db.from('license_plans').select('*').order('price_monthly');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Tenants ──────────────────────────────────────────────────────────────
  async getTenants(search?: string) {
    let query = this.db
      .from('tenant_license_status')
      .select('*')
      .order('tenant_name');
    if (search) query = query.ilike('tenant_name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTenant(tenantId: string) {
    const { data, error } = await this.db
      .from('tenant_license_status')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();
    if (error || !data) throw new NotFoundException('Tenant não encontrado');
    return data;
  }

  async createTenant(dto: CreateTenantDto, userId?: string) {
    const { data: tenant, error: tenantErr } = await this.db
      .from('tenants')
      .insert({
        name: dto.name, document: dto.document,
        email: dto.email, phone: dto.phone,
        city: dto.city, state: dto.state,
      })
      .select().single();
    if (tenantErr) throw new BadRequestException(tenantErr.message);

    // Cria licença inicial baseada no plano escolhido
    const plan = await this.getPlanDefaults(dto.plan);
    const trialDays = 14;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (dto.trialDays ?? trialDays));
    const trialEndsAt = new Date(expiresAt);

    const { data: license, error: licErr } = await this.db
      .from('licenses')
      .insert({
        tenant_id:     tenant.id,
        plan:          dto.plan,
        status:        'trial',
        max_users:     dto.maxUsers   ?? plan.max_users,
        max_farms:     dto.maxFarms   ?? plan.max_farms,
        modules:       dto.modules    ?? plan.modules,
        starts_at:     new Date().toISOString().split('T')[0],
        expires_at:    expiresAt.toISOString().split('T')[0],
        trial_ends_at: trialEndsAt.toISOString().split('T')[0],
      })
      .select().single();
    if (licErr) throw new BadRequestException(licErr.message);

    // Registra no histórico
    await this.addHistory(license.id, tenant.id, 'created', null, dto.plan, null, 'trial', userId);

    return { tenant, license };
  }

  // ── Licenças ─────────────────────────────────────────────────────────────
  async getLicense(tenantId: string) {
    const { data, error } = await this.db
      .from('licenses')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();
    if (error || !data) throw new NotFoundException('Licença não encontrada');
    return data;
  }

  async updateLicense(tenantId: string, dto: UpdateLicenseDto, userId?: string) {
    const current = await this.getLicense(tenantId);

    // Se mudou de plano, aplica defaults do novo plano
    let planDefaults: any = {};
    if (dto.plan && dto.plan !== current.plan) {
      planDefaults = await this.getPlanDefaults(dto.plan);
    }

    const updates: any = {
      ...(dto.plan       ? { plan: dto.plan }                                   : {}),
      ...(dto.status     ? { status: dto.status }                               : {}),
      ...(dto.maxUsers   ? { max_users: dto.maxUsers }                          : {}),
      ...(dto.maxFarms   ? { max_farms: dto.maxFarms }                          : {}),
      ...(dto.modules    ? { modules: dto.modules }                             : {}),
      ...(dto.expiresAt  ? { expires_at: dto.expiresAt }                        : {}),
      ...(dto.notes      ? { notes: dto.notes }                                 : {}),
      // Aplica defaults do plano se mudou
      ...(planDefaults.max_users && !dto.maxUsers ? { max_users: planDefaults.max_users } : {}),
      ...(planDefaults.modules   && !dto.modules  ? { modules: planDefaults.modules }     : {}),
    };

    const { data, error } = await this.db
      .from('licenses')
      .update(updates)
      .eq('tenant_id', tenantId)
      .select().single();
    if (error) throw new BadRequestException(error.message);

    // Histórico
    const event = dto.plan && dto.plan !== current.plan
      ? (dto.plan > current.plan ? 'upgraded' : 'downgraded')
      : dto.status && dto.status !== current.status
        ? dto.status
        : 'updated';

    await this.addHistory(
      current.id, tenantId, event,
      current.plan, dto.plan ?? current.plan,
      current.status, dto.status ?? current.status,
      userId, dto.notes,
    );

    // Sincroniza menu_modules com os módulos ativos da licença
    await this.syncModules(data.modules);

    return data;
  }

  async suspendLicense(tenantId: string, userId?: string) {
    return this.updateLicense(tenantId, { status: 'suspended' } as any, userId);
  }

  async reactivateLicense(tenantId: string, userId?: string) {
    return this.updateLicense(tenantId, { status: 'active' } as any, userId);
  }

  async renewLicense(tenantId: string, months: number, userId?: string) {
    const current = await this.getLicense(tenantId);
    const base = new Date(current.expires_at) > new Date()
      ? new Date(current.expires_at)
      : new Date();
    base.setMonth(base.getMonth() + months);

    return this.updateLicense(tenantId, {
      status: 'active',
      expiresAt: base.toISOString().split('T')[0],
    } as any, userId);
  }

  // ── Vencimentos próximos ─────────────────────────────────────────────────
  async getExpiringSoon() {
    const { data, error } = await this.db
      .from('licenses_expiring_soon')
      .select('*');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Histórico de um tenant ───────────────────────────────────────────────
  async getHistory(tenantId: string) {
    const { data, error } = await this.db
      .from('license_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── KPIs gerais ──────────────────────────────────────────────────────────
  async getStats() {
    const { data, error } = await this.db
      .from('tenant_license_status')
      .select('status, plan, days_remaining, expiring_soon');
    if (error) throw new BadRequestException(error.message);

    return {
      total:         data.length,
      active:        data.filter((r: any) => r.status === 'active').length,
      trial:         data.filter((r: any) => r.status === 'trial').length,
      suspended:     data.filter((r: any) => r.status === 'suspended').length,
      expired:       data.filter((r: any) => r.status === 'expired').length,
      expiringSoon:  data.filter((r: any) => r.expiring_soon).length,
      byPlan: {
        start:      data.filter((r: any) => r.plan === 'start').length,
        growth:     data.filter((r: any) => r.plan === 'growth').length,
        pro:        data.filter((r: any) => r.plan === 'pro').length,
        enterprise: data.filter((r: any) => r.plan === 'enterprise').length,
      },
    };
  }

  // ── Helpers privados ─────────────────────────────────────────────────────
  private async getPlanDefaults(plan: string) {
    const { data } = await this.db
      .from('license_plans')
      .select('*')
      .eq('plan', plan)
      .single();
    return data ?? { max_users: 3, max_farms: 1, modules: ['farm','financial','inventory'] };
  }

  private async syncModules(activeModules: string[]) {
    // Desativa todos, depois ativa só os da licença
    await this.db.from('menu_modules').update({ active: false });
    if (activeModules.length > 0) {
      await this.db.from('menu_modules').update({ active: true }).in('key', activeModules);
    }
  }

  private async addHistory(
    licenseId: string, tenantId: string, event: string,
    oldPlan: any, newPlan: any, oldStatus: any, newStatus: any,
    changedBy?: string, notes?: string,
  ) {
    await this.db.from('license_history').insert({
      license_id: licenseId, tenant_id: tenantId, event,
      old_plan: oldPlan, new_plan: newPlan,
      old_status: oldStatus, new_status: newStatus,
      changed_by: changedBy, notes,
    });
  }
}
