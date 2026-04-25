import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { AuditService } from '../audit/audit.service';

const ROLES = ['owner','manager','agronomist','accountant','operator','viewer'] as const;
type Role = typeof ROLES[number];

@Injectable()
export class MenusService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  // ── Catálogo completo de módulos com itens ───────────────────────────────
  async getModules() {
    const { data, error } = await this.supabase.getAdminClient()
      .from('menu_modules')
      .select('*, menu_items(*)') 
      .order('sort_order')
      .order('sort_order', { referencedTable: 'menu_items' });
    if (error) throw new Error(error.message);
    return data;
  }

  // ── ACL por módulo: quais perfis têm acesso ──────────────────────────────
  async getModuleAcl(moduleId: string) {
    const { data, error } = await this.supabase.getAdminClient()
      .from('menu_module_acl')
      .select('role, can_access')
      .eq('module_id', moduleId);
    if (error) throw new Error(error.message);
    // Retorna um mapa role → boolean para facilitar o frontend
    const result: Record<string, boolean> = {};
    ROLES.forEach(r => result[r] = false);
    data.forEach((row: any) => result[row.role] = row.can_access);
    return result;
  }

  // ── ACL por item: quais perfis têm acesso ────────────────────────────────
  async getItemAcl(itemId: string) {
    const { data, error } = await this.supabase.getAdminClient()
      .from('menu_item_acl')
      .select('role, can_access')
      .eq('item_id', itemId);
    if (error) throw new Error(error.message);
    const result: Record<string, boolean> = {};
    ROLES.forEach(r => result[r] = true); // default: acesso liberado
    data.forEach((row: any) => result[row.role] = row.can_access);
    return result;
  }

  // ── ACL completa: todos módulos e itens com acesso por perfil ────────────
  async getFullAcl() {
    const [modulesRes, moduleAclRes, itemsRes, itemAclRes] = await Promise.all([
      this.supabase.getAdminClient().from('menu_modules').select('id, key, label, icon, active, sort_order').order('sort_order'),
      this.supabase.getAdminClient().from('menu_module_acl').select('module_id, role, can_access'),
      this.supabase.getAdminClient().from('menu_items').select('id, module_id, key, label, href, badge, active, sort_order').order('sort_order'),
      this.supabase.getAdminClient().from('menu_item_acl').select('item_id, role, can_access'),
    ]);

    const modules = modulesRes.data ?? [];
    const moduleAcl = moduleAclRes.data ?? [];
    const items = itemsRes.data ?? [];
    const itemAcl = itemAclRes.data ?? [];

    return modules.map((mod: any) => ({
      ...mod,
      acl: ROLES.reduce((acc, role) => {
        const row = moduleAcl.find((a: any) => a.module_id === mod.id && a.role === role);
        acc[role] = row ? row.can_access : true;
        return acc;
      }, {} as Record<string, boolean>),
      items: items
        .filter((i: any) => i.module_id === mod.id)
        .map((item: any) => ({
          ...item,
          acl: ROLES.reduce((acc, role) => {
            const row = itemAcl.find((a: any) => a.item_id === item.id && a.role === role);
            acc[role] = row ? row.can_access : true;
            return acc;
          }, {} as Record<string, boolean>),
        })),
    }));
  }

  // ── Atualizar ACL de módulo ───────────────────────────────────────────────
  async updateModuleAcl(moduleId: string, acl: Record<string, boolean>) {
    const admin = this.supabase.getAdminClient();
    const rows = Object.entries(acl).map(([role, can_access]) => ({
      module_id: moduleId, role, can_access,
    }));
    const { error } = await admin.from('menu_module_acl')
      .upsert(rows, { onConflict: 'module_id,role' });
    if (error) throw new Error(error.message);

    await this.audit?.log({
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'menu_module_acl',
      entityId: moduleId,
      description: 'ACL do módulo atualizada',
      newValues: acl,
      success: true,
    });

    return { message: 'ACL do módulo atualizada' };
  }

  // ── Atualizar ACL de item ────────────────────────────────────────────────
  async updateItemAcl(itemId: string, acl: Record<string, boolean>) {
    const admin = this.supabase.getAdminClient();
    const rows = Object.entries(acl).map(([role, can_access]) => ({
      item_id: itemId, role, can_access,
    }));
    const { error } = await admin.from('menu_item_acl')
      .upsert(rows, { onConflict: 'item_id,role' });
    if (error) throw new Error(error.message);

    await this.audit?.log({
      eventType: 'permission_changed',
      module: 'admin',
      entity: 'menu_item_acl',
      entityId: itemId,
      description: 'ACL do item atualizada',
      newValues: acl,
      success: true,
    });

    return { message: 'ACL do item atualizada' };
  }

  // ── Ativar / desativar módulo (licença) ──────────────────────────────────
  async toggleModule(moduleId: string, active: boolean) {
    const { error } = await this.supabase.getAdminClient()
      .from('menu_modules')
      .update({ active })
      .eq('id', moduleId);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      eventType: active ? 'module_activated' : 'module_deactivated',
      module: 'admin',
      entity: 'menu_module',
      entityId: moduleId,
      description: active ? 'Módulo de menu ativado' : 'Módulo de menu desativado',
      newValues: { active },
      success: true,
    });

    return { moduleId, active };
  }

  // ── Ativar / desativar item ───────────────────────────────────────────────
  async toggleItem(itemId: string, active: boolean) {
    const { error } = await this.supabase.getAdminClient()
      .from('menu_items')
      .update({ active })
      .eq('id', itemId);
    if (error) throw new Error(error.message);

    await this.audit?.log({
      eventType: active ? 'module_activated' : 'module_deactivated',
      module: 'admin',
      entity: 'menu_item',
      entityId: itemId,
      description: active ? 'Item de menu ativado' : 'Item de menu desativado',
      newValues: { active },
      success: true,
    });

    return { itemId, active };
  }

  // ── Menu resolvido para um perfil (usado pelo sidebar no frontend) ────────
  async getMenuForRole(role: Role) {
    const { data, error } = await this.supabase.getAdminClient()
      .from('menu_by_role')
      .select('*')
      .eq('role', role)
      .eq('module_active', true)
      .eq('item_active', true)
      .eq('module_can_access', true);
    if (error) throw new Error(error.message);

    // Agrupa por módulo
    const grouped: Record<string, any> = {};
    for (const row of (data ?? [])) {
      if (!grouped[row.module_id]) {
        grouped[row.module_id] = {
          id: row.module_id, key: row.module_key,
          label: row.module_label, icon: row.module_icon,
          order: row.module_order, items: [],
        };
      }
      if (row.item_can_access !== false) {
        grouped[row.module_id].items.push({
          id: row.item_id, key: row.item_key,
          label: row.item_label, href: row.item_href,
          badge: row.item_badge, order: row.item_order,
        });
      }
    }

    return Object.values(grouped)
      .sort((a: any, b: any) => a.order - b.order)
      .map((mod: any) => ({
        ...mod,
        items: mod.items.sort((a: any, b: any) => a.order - b.order),
      }));
  }
}
