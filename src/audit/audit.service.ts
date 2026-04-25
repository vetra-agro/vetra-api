import { Injectable } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { Request } from 'express';

export type AuditEventType =
  | 'login_success' | 'login_failed' | 'logout' | 'password_reset' | 'token_refresh'
  | 'record_created' | 'record_updated' | 'record_deleted' | 'record_viewed'
  | 'approved' | 'rejected' | 'exported' | 'printed' | 'imported'
  | 'module_activated' | 'module_deactivated' | 'license_changed'
  | 'permission_changed' | 'settings_changed';

export interface LogEventOptions {
  userId?:      string;
  userName?:    string;
  userEmail?:   string;
  userRole?:    string;
  tenantId?:    string;
  eventType:    AuditEventType;
  module?:      string;
  entity?:      string;
  entityId?:    string;
  entityLabel?: string;
  description:  string;
  oldValues?:   Record<string, any>;
  newValues?:   Record<string, any>;
  metadata?:    Record<string, any>;
  ipAddress?:   string;
  success?:     boolean;
  errorMessage?:string;
}

export interface AuditFilters {
  userId?:     string;
  tenantId?:   string;
  module?:     string;
  eventType?:  string;
  entity?:     string;
  success?:    boolean;
  dateFrom?:   string;
  dateTo?:     string;
  search?:     string;
  page?:       number;
  limit?:      number;
}

@Injectable()
export class AuditService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Registrar evento (chamado por outros services) ───────────────────────
  async log(opts: LogEventOptions): Promise<void> {
    try {
      await this.db.from('audit_logs').insert({
        user_id:       opts.userId,
        user_name:     opts.userName,
        user_email:    opts.userEmail,
        user_role:     opts.userRole,
        tenant_id:     opts.tenantId,
        event_type:    opts.eventType,
        module:        opts.module,
        entity:        opts.entity,
        entity_id:     opts.entityId,
        entity_label:  opts.entityLabel,
        description:   opts.description,
        old_values:    opts.oldValues ?? null,
        new_values:    opts.newValues ?? null,
        metadata:      opts.metadata ?? null,
        ip_address:    opts.ipAddress ?? null,
        success:       opts.success ?? true,
        error_message: opts.errorMessage ?? null,
      });
    } catch (e) {
      // Auditoria nunca deve quebrar o fluxo principal
      console.error('[AuditService] Falha ao registrar log:', e);
    }
  }

  // ── Helper para extrair IP da request ────────────────────────────────────
  extractIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  // ── Listar logs com filtros e paginação ──────────────────────────────────
  async findAll(filters: AuditFilters = {}) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let query = this.db
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (filters.userId)    query = query.eq('user_id', filters.userId);
    if (filters.tenantId)  query = query.eq('tenant_id', filters.tenantId);
    if (filters.module)    query = query.eq('module', filters.module);
    if (filters.entity)    query = query.eq('entity', filters.entity);
    if (filters.eventType) query = query.eq('event_type', filters.eventType);
    if (filters.success != null) query = query.eq('success', filters.success);
    if (filters.dateFrom)  query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo)    query = query.lte('created_at', filters.dateTo);
    if (filters.search) {
      query = query.or(
        `description.ilike.%${filters.search}%,user_name.ilike.%${filters.search}%,entity_label.ilike.%${filters.search}%`
      );
    }

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    return {
      data,
      meta: {
        total: count ?? 0,
        page,
        limit,
        pages: Math.ceil((count ?? 0) / limit),
      },
    };
  }

  // ── Detalhe de um log ────────────────────────────────────────────────────
  async findOne(id: string) {
    const { data, error } = await this.db
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error('Log não encontrado');
    return data;
  }

  // ── Logs de acesso ───────────────────────────────────────────────────────
  async getAccessLogs(filters: AuditFilters = {}) {
    return this.findAll({
      ...filters,
      eventType: undefined, // sobrescrito abaixo com lista
    }).then(async () => {
      let query = this.db
        .from('audit_logs')
        .select('id, user_id, user_name, user_email, user_role, tenant_id, event_type, description, ip_address, user_agent, success, error_message, created_at', { count: 'exact' })
        .in('event_type', ['login_success','login_failed','logout','password_reset','token_refresh'])
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 100);

      if (filters.userId)   query = query.eq('user_id', filters.userId);
      if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
      if (filters.dateTo)   query = query.lte('created_at', filters.dateTo);
      if (filters.success != null) query = query.eq('success', filters.success);

      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      return { data, total: count };
    });
  }

  // ── KPIs e stats ─────────────────────────────────────────────────────────
  async getStats(tenantId?: string) {
    let query = this.db
      .from('audit_logs')
      .select('event_type, success, module, created_at');

    if (tenantId) query = query.eq('tenant_id', tenantId);

    // Últimas 24h
    const { data: last24h } = await query
      .gte('created_at', new Date(Date.now() - 86400000).toISOString());

    // Últimos 30 dias
    const { data: last30d } = await this.db
      .from('audit_logs')
      .select('event_type, success, module, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

    const all24h = last24h ?? [];
    const all30d = last30d ?? [];

    return {
      last24h: {
        total:          all24h.length,
        logins:         all24h.filter((e: any) => e.event_type === 'login_success').length,
        loginsFailed:   all24h.filter((e: any) => e.event_type === 'login_failed').length,
        operations:     all24h.filter((e: any) => ['record_created','record_updated','record_deleted'].includes(e.event_type)).length,
        errors:         all24h.filter((e: any) => !e.success).length,
      },
      last30d: {
        total:          all30d.length,
        byModule:       this.groupBy(all30d, 'module'),
        byEventType:    this.groupBy(all30d, 'event_type'),
        errorRate:      all30d.length > 0
          ? Math.round((all30d.filter((e: any) => !e.success).length / all30d.length) * 100)
          : 0,
      },
    };
  }

  // ── Atividade por usuário ────────────────────────────────────────────────
  async getUserActivity(tenantId?: string) {
    let query = this.db
      .from('user_activity_summary')
      .select('*');
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }

  // ── Exportar CSV ─────────────────────────────────────────────────────────
  async exportCsv(filters: AuditFilters = {}) {
    const { data } = await this.findAll({ ...filters, limit: 5000 });
    const headers = ['data','usuário','email','perfil','módulo','evento','descrição','entidade','sucesso','IP'];
    const rows = (data ?? []).map((r: any) => [
      new Date(r.created_at).toLocaleString('pt-BR'),
      r.user_name ?? '',
      r.user_email ?? '',
      r.user_role ?? '',
      r.module ?? '',
      r.event_type,
      r.description,
      r.entity_label ?? r.entity ?? '',
      r.success ? 'Sim' : 'Não',
      r.ip_address ?? '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  private groupBy(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, item) => {
      const k = item[key] ?? 'unknown';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  }
}
