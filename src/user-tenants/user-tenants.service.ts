import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class UserTenantsService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Listar usuários de um tenant ─────────────────────────────────────────
  async getUsersByTenant(tenantId: string) {
    // 1. Busca vínculos sem filtro active e sem !inner
    const { data: links, error: linksError } = await this.db
      .from("user_tenants")
      .select("id, user_id, tenant_id, role, is_default, active, invited_at, accepted_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (linksError) throw new Error(linksError.message);
    if (!links || links.length === 0) return [];

    // 2. Busca perfis separadamente — evita !inner que quebra se FK não existe
    const userIds = links.map((l: any) => l.user_id).filter(Boolean);

    const { data: profiles } = await this.db
      .from("profiles")
      .select("id, full_name, email, avatar_url, role")
      .in("id", userIds);

    // 3. Mescla em JS — seguro independente do estado do banco
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    return links.map((link: any) => ({
      ...link,
      profile: profileMap.get(link.user_id) ?? {
        id:         link.user_id,
        full_name:  "Usuário sem perfil",
        email:      null,
        avatar_url: null,
        role:       link.role,
      },
    }));
  }

  // ── Listar tenants de um usuário ─────────────────────────────────────────
  async getTenantsByUser(userId: string) {
    const { data, error } = await this.db
      .from("user_available_tenants")
      .select("*")
      .eq("user_id", userId)
      .order("is_default", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // ── Buscar usuários disponíveis para vincular ─────────────────────────────
  async getAvailableUsers(tenantId: string) {
    // 1. IDs já vinculados ao tenant
    const { data: linked } = await this.db
      .from("user_tenants")
      .select("user_id")
      .eq("tenant_id", tenantId);

    const linkedIds = (linked ?? [])
      .map((l: any) => l.user_id as string)
      .filter(Boolean);

    // 2. Todos os perfis sem filtro active
    const { data: allProfiles, error } = await this.db
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name");

    if (error) throw new Error(error.message);

    // 3. Filtra em JS
    return (allProfiles ?? []).filter(
      (p: any) => !linkedIds.includes(p.id)
    );
  }

  // ── Vincular usuário a um tenant ─────────────────────────────────────────
  async linkUser(dto: {
    tenantId:   string;
    userId:     string;
    role:       string;
    isDefault?: boolean;
    invitedBy?: string;
  }) {
    const { data: profile } = await this.db
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", dto.userId)
      .maybeSingle();

    if (!profile) throw new NotFoundException("Usuário não encontrado");

    const { data: existing } = await this.db
      .from("user_tenants")
      .select("id, active")
      .eq("user_id",   dto.userId)
      .eq("tenant_id", dto.tenantId)
      .maybeSingle();

    if (existing) {
      if (existing.active === true) {
        throw new ConflictException("Usuário já está vinculado a este tenant");
      }
      const { error } = await this.db
        .from("user_tenants")
        .update({ active: true, role: dto.role, accepted_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { reactivated: true, userId: dto.userId };
    }

    const { data, error } = await this.db
      .from("user_tenants")
      .insert({
        user_id:     dto.userId,
        tenant_id:   dto.tenantId,
        role:        dto.role ?? "viewer",
        is_default:  dto.isDefault ?? false,
        active:      true,
        invited_by:  dto.invitedBy ?? null,
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    if (dto.isDefault) {
      await this.db.rpc("set_default_tenant", {
        p_user_id:   dto.userId,
        p_tenant_id: dto.tenantId,
      });
    }

    return data;
  }

  // ── Desvincular usuário ───────────────────────────────────────────────────
  async unlinkUser(tenantId: string, userId: string) {
    const { error } = await this.db
      .from("user_tenants")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("user_id",   userId);
    if (error) throw new Error(error.message);
    return { unlinked: true };
  }

  // ── Atualizar role ────────────────────────────────────────────────────────
  async updateRole(tenantId: string, userId: string, role: string) {
    const { error } = await this.db
      .from("user_tenants")
      .update({ role })
      .eq("tenant_id", tenantId)
      .eq("user_id",   userId);
    if (error) throw new Error(error.message);
    return { updated: true };
  }

  // ── Definir tenant padrão ─────────────────────────────────────────────────
  async setDefault(userId: string, tenantId: string) {
    const { error } = await this.db.rpc("set_default_tenant", {
      p_user_id: userId, p_tenant_id: tenantId,
    });
    if (error) throw new Error(error.message);
    return { default: tenantId };
  }

  // ── Seed ──────────────────────────────────────────────────────────────────
  async seedLinkAllToTenant(tenantId: string, invitedBy?: string) {
    const { data: profiles } = await this.db
      .from("profiles").select("id, role");

    const rows = (profiles ?? []).map((p: any) => ({
      user_id: p.id, tenant_id: tenantId,
      role: p.role ?? "viewer", is_default: true,
      active: true, accepted_at: new Date().toISOString(),
      invited_by: invitedBy ?? null,
    }));

    if (rows.length === 0) return { linked: 0 };

    const { error } = await this.db
      .from("user_tenants")
      .upsert(rows, { onConflict: "user_id,tenant_id" });

    if (error) throw new Error(error.message);
    return { linked: rows.length };
  }
}