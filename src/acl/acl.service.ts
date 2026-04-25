import { Injectable, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { AuditService } from '../audit/audit.service';

export type UserRole = 'owner' | 'manager' | 'agronomist' | 'accountant' | 'operator' | 'viewer';
export type AclAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'approve' | 'print' | 'admin';

export const ALL_ROLES: UserRole[] = ['owner','manager','agronomist','accountant','operator','viewer'];
export const ALL_ACTIONS: AclAction[] = ['view','create','edit','delete','export','approve','print','admin'];

export const MODULES = [
  'admin','farm','financial','accounting','purchasing',
  'sales','logistics','fiscal','maintenance','inventory',
  'production','services','analytics',
] as const;

@Injectable()
export class AclService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  // ── Matriz completa: todos perfis × todos módulos ────────────────────────
  async getMatrix() {
    const { data, error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .select('role, module_key, action, allowed')
      .order('role').order('module_key').order('action');
    if (error) throw new Error(error.message);

    // Organiza: role → module_key → action → boolean
    const matrix: Record<string, Record<string, Record<string, boolean>>> = {};
    for (const row of data) {
      if (!matrix[row.role]) matrix[row.role] = {};
      if (!matrix[row.role][row.module_key]) matrix[row.role][row.module_key] = {};
      matrix[row.role][row.module_key][row.action] = row.allowed;
    }
    return matrix;
  }

  // ── Permissões de um perfil específico ───────────────────────────────────
  async getByRole(role: UserRole) {
    const { data, error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .select('module_key, action, allowed, updated_at')
      .eq('role', role)
      .order('module_key').order('action');
    if (error) throw new Error(error.message);

    // Agrupa por módulo
    const grouped: Record<string, Record<string, boolean>> = {};
    for (const row of data) {
      if (!grouped[row.module_key]) grouped[row.module_key] = {};
      grouped[row.module_key][row.action] = row.allowed;
    }
    return grouped;
  }

  // ── Atualizar permissão individual ───────────────────────────────────────
  async updatePermission(
    role: UserRole,
    moduleKey: string,
    action: AclAction,
    allowed: boolean,
    updatedBy?: string,
  ) {
    const { error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .upsert({ role, module_key: moduleKey, action, allowed, updated_by: updatedBy },
        { onConflict: 'role,module_key,action' });
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId: updatedBy,
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'acl_permissions',
      description: 'Permissão ACL atualizada',
      metadata: { role, moduleKey, action },
      newValues: { allowed },
      success: true,
    });

    return { role, moduleKey, action, allowed };
  }

  // ── Atualizar permissões em lote (um perfil inteiro) ─────────────────────
  async updateRolePermissions(
    role: UserRole,
    permissions: Array<{ moduleKey: string; action: AclAction; allowed: boolean }>,
    updatedBy?: string,
  ) {
    const rows = permissions.map(({ moduleKey, action, allowed }) => ({
      role, module_key: moduleKey, action, allowed, updated_by: updatedBy,
    }));

    const { error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .upsert(rows, { onConflict: 'role,module_key,action' });
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId: updatedBy,
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'acl_permissions',
      description: 'Permissões ACL atualizadas em lote',
      metadata: { role },
      newValues: { permissions },
      success: true,
    });

    return { updated: rows.length };
  }

  // ── Copiar permissões de um perfil para outro ────────────────────────────
  async copyRole(fromRole: UserRole, toRole: UserRole, updatedBy?: string) {
    const source = await this.getByRole(fromRole);
    const rows: any[] = [];

    for (const [moduleKey, actions] of Object.entries(source)) {
      for (const [action, allowed] of Object.entries(actions)) {
        rows.push({ role: toRole, module_key: moduleKey, action, allowed, updated_by: updatedBy });
      }
    }

    const { error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .upsert(rows, { onConflict: 'role,module_key,action' });
    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId: updatedBy,
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'acl_permissions',
      description: 'Permissões ACL copiadas entre perfis',
      metadata: { fromRole, toRole, copied: rows.length },
      success: true,
    });

    return { copied: rows.length, from: fromRole, to: toRole };
  }

  // ── Resetar perfil para permissões padrão ────────────────────────────────
  async resetRole(role: UserRole) {
    const { error } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .delete()
      .eq('role', role);
    if (error) throw new Error(error.message);
    // Re-executa o seed default (via função SQL)
    await this.supabase.getAdminClient().rpc('reset_role_acl', { p_role: role });

    await this.audit?.log({
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'acl_permissions',
      description: 'Permissões ACL resetadas para o perfil',
      metadata: { role },
      success: true,
    });

    return { reset: true, role };
  }

  // ── Verificar permissão pontual ───────────────────────────────────────────
  async check(role: UserRole, moduleKey: string, action: AclAction): Promise<boolean> {
    const { data } = await this.supabase.getAdminClient()
      .from('acl_permissions')
      .select('allowed')
      .eq('role', role)
      .eq('module_key', moduleKey)
      .eq('action', action)
      .single();
    return data?.allowed ?? false;
  }

  // ── Histórico de alterações ───────────────────────────────────────────────
  async getHistory(role?: UserRole) {
    let query = this.supabase.getAdminClient()
      .from('acl_permissions')
      .select('role, module_key, action, allowed, updated_at, updated_by')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (role) query = query.eq('role', role);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }
}
