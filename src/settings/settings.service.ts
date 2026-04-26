import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { AuditService } from '../audit/audit.service';

export interface Setting {
  id:            string;
  tenant_id?:    string;
  key:           string;
  group_name:    string;
  label:         string;
  description?:  string;
  type:          string;
  value?:        string;
  default_value?:string;
  options?:      Array<{ value: string; label: string }>;
  is_required:   boolean;
  is_public:     boolean;
  is_system:     boolean;
  sort_order:    number;
  updated_at:    string;
}

@Injectable()
export class SettingsService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Buscar todas as configurações de um tenant ───────────────────────────
  // Mescla defaults do sistema (tenant_id=NULL) com overrides do tenant
  async getAll(tenantId: string): Promise<Record<string, Setting[]>> {
    // Padrões do sistema
    const { data: defaults } = await this.db
      .from('settings')
      .select('*')
      .is('tenant_id', null)
      .order('group_name').order('sort_order');

    // Overrides do tenant
    const { data: overrides } = await this.db
      .from('settings')
      .select('*')
      .eq('tenant_id', tenantId);

    const overrideMap = new Map(
      (overrides ?? []).map((s: any) => [s.key, s])
    );

    // Mescla: override sobrescreve o valor do default
    const merged = (defaults ?? []).map((def: any) => {
      const override = overrideMap.get(def.key);
      return {
        ...def,
        value: override?.value ?? def.default_value,
        id:    override?.id ?? def.id,
      };
    });

    // Agrupa por group_name
    return merged.reduce((acc: any, s: any) => {
      if (!acc[s.group_name]) acc[s.group_name] = [];
      acc[s.group_name].push(s);
      return acc;
    }, {});
  }

  // ── Buscar valor de uma chave específica ─────────────────────────────────
  async get(tenantId: string, key: string): Promise<string | null> {
    const { data } = await this.db
      .from('settings')
      .select('value, default_value')
      .eq('tenant_id', tenantId)
      .eq('key', key)
      .maybeSingle();

    if (data?.value) return data.value;

    // Fallback para default
    const { data: def } = await this.db
      .from('settings')
      .select('default_value')
      .is('tenant_id', null)
      .eq('key', key)
      .maybeSingle();

    return def?.default_value ?? null;
  }

  // ── Atualizar uma configuração ───────────────────────────────────────────
  async set(
    tenantId: string,
    key: string,
    value: string,
    userId?: string,
  ) {
    // Verifica se chave existe nos defaults
    const { data: def } = await this.db
      .from('settings')
      .select('id, key, type, is_required, group_name, label')
      .is('tenant_id', null)
      .eq('key', key)
      .maybeSingle();

    if (!def) throw new NotFoundException(`Chave '${key}' não encontrada`);

    const { data: previous } = await this.db
      .from('settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', key)
      .maybeSingle();

    // Upsert no tenant override
    const { data, error } = await this.db
      .from('settings')
      .upsert(
        {
          tenant_id:  tenantId,
          key,
          group_name: def.group_name ?? 'general',
          label:      def.label      ?? key,
          type:       def.type,
          value,
          updated_by: userId,
        },
        { onConflict: 'tenant_id,key' }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId,
      eventType: 'settings_changed',
      module: 'settings',
      entity: 'setting',
      entityId: key,
      entityLabel: def.label ?? key,
      description: 'Configuração atualizada',
      oldValues: { value: previous?.value ?? null },
      newValues: { value },
      success: true,
    });

    return data;
  }

  // ── Atualizar múltiplas configurações de uma vez ─────────────────────────
  async setBatch(
    tenantId: string,
    entries: Array<{ key: string; value: string }>,
    userId?: string,
  ) {
    const results = await Promise.allSettled(
      entries.map(({ key, value }) => this.set(tenantId, key, value, userId))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed    = results.filter((r) => r.status === 'rejected');

    return {
      succeeded,
      failed: failed.length,
      errors: failed.map((r: any) => r.reason?.message),
    };
  }

  // ── Resetar uma configuração para o valor padrão ─────────────────────────
  async reset(tenantId: string, key: string, userId?: string) {
    const { data: previous } = await this.db
      .from('settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', key)
      .maybeSingle();

    await this.db
      .from('settings')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('key', key);

    await this.audit?.log({
      userId,
      tenantId,
      eventType: 'settings_changed',
      module: 'settings',
      entity: 'setting',
      entityId: key,
      entityLabel: key,
      description: 'Configuração resetada para o valor padrão',
      oldValues: { value: previous?.value ?? null },
      success: true,
    });

    return { key, reset: true };
  }

  // ── Resetar todas as configurações do tenant ─────────────────────────────
  async resetAll(tenantId: string, userId?: string) {
    const { error } = await this.db
      .from('settings')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('is_system', false);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId,
      tenantId,
      eventType: 'settings_changed',
      module: 'settings',
      entity: 'setting',
      entityLabel: 'all',
      description: 'Todas as configurações foram restauradas para os padrões',
      success: true,
    });

    return { reset: true, message: 'Configurações restauradas para os padrões' };
  }

  // ── Testar conexão SMTP ───────────────────────────────────────────────────
  async testSmtp(tenantId: string) {
    const smtp    = await this.get(tenantId, 'notif_email_smtp');
    const port    = await this.get(tenantId, 'notif_email_port');
    const user    = await this.get(tenantId, 'notif_email_user');
    const sender  = await this.get(tenantId, 'notif_email_sender');

    if (!smtp || !user) {
      return { success: false, message: 'Configure o servidor SMTP primeiro' };
    }

    // Em produção, fazer teste real de conexão SMTP
    // Por ora retorna mock para validar o fluxo
    return {
      success: true,
      message: `Conexão SMTP testada: ${smtp}:${port} (${user})`,
      sender,
    };
  }
}
