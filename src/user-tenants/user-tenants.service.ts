import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class UserTenantsService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Listar usuários de um tenant ─────────────────────────────────────────
  async getUsersByTenant(tenantId: string) {
    const { data, error } = await this.db
      .from("user_tenants")
      .select(`
        id, user_id, role, is_default, active,
        invited_at, accepted_at,
        profiles!inner(full_name, email, avatar_url)
      `)
      .eq("tenant_id", tenantId)
      .order("invited_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
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

  // ── Vincular usuário a um tenant ─────────────────────────────────────────
  async linkUser(dto: {
    tenantId: string;
    userId:   string;
    role:     string;
    isDefault?:boolean;
    invitedBy?:string;
  }) {
    // Verifica se o usuário existe
    const { data: profile } = await this.db
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", dto.userId)
      .single();

    if (!profile) throw new NotFoundException("Usuário não encontrado");

    // Verifica se já está vinculado
    const { data: existing } = await this.db
      .from("user_tenants")
      .select("id, active")
      .eq("user_id", dto.userId)
      .eq("tenant_id", dto.tenantId)
      .maybeSingle();

    if (existing) {
      if (existing.active) throw new ConflictException("Usuário já vinculado a este tenant");
      // Reativar vínculo desativado
      await this.db
        .from("user_tenants")
        .update({ active: true, role: dto.role, accepted_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { reactivated: true, userId: dto.userId };
    }

    // Novo vínculo
    const { data, error } = await this.db
      .from("user_tenants")
      .insert({
        user_id:     dto.userId,
        tenant_id:   dto.tenantId,
        role:        dto.role ?? "viewer",
        is_default:  dto.isDefault ?? false,
        invited_by:  dto.invitedBy,
        accepted_at: new Date().toISOString(), // auto-aceita no PoC
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Se is_default, remove default dos outros
    if (dto.isDefault) {
      await this.db.rpc("set_default_tenant", {
        p_user_id:   dto.userId,
        p_tenant_id: dto.tenantId,
      });
    }

    return data;
  }

  // ── Desvincular usuário de um tenant ─────────────────────────────────────
  async unlinkUser(tenantId: string, userId: string) {
    const { error } = await this.db
      .from("user_tenants")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { unlinked: true };
  }

  // ── Atualizar role do usuário num tenant ─────────────────────────────────
  async updateRole(tenantId: string, userId: string, role: string) {
    const { error } = await this.db
      .from("user_tenants")
      .update({ role })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { updated: true };
  }

  // ── Definir tenant padrão do usuário ─────────────────────────────────────
  async setDefault(userId: string, tenantId: string) {
    await this.db.rpc("set_default_tenant", {
      p_user_id: userId, p_tenant_id: tenantId,
    });
    return { default: tenantId };
  }

  // ── Buscar todos os usuários disponíveis para vincular ───────────────────
  async getAvailableUsers(tenantId: string) {
    // Retorna usuários que NÃO estão vinculados a este tenant
    const { data: linked } = await this.db
      .from("user_tenants")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    const linkedIds = (linked ?? []).map((l: any) => l.user_id);

    let query = this.db
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("active", true)
      .order("full_name");

    if (linkedIds.length > 0) {
      query = query.not("id", "in", `(${linkedIds.join(",")})`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // ── Seed: vincular todos os usuários existentes a um tenant ──────────────
  async seedLinkAllToTenant(tenantId: string, invitedBy?: string) {
    const { data: profiles } = await this.db
      .from("profiles")
      .select("id, role")
      .eq("active", true);

    const rows = (profiles ?? []).map((p: any) => ({
      user_id:     p.id,
      tenant_id:   tenantId,
      role:        p.role,
      is_default:  true,
      accepted_at: new Date().toISOString(),
      invited_by:  invitedBy,
    }));

    if (rows.length === 0) return { linked: 0 };

    const { error } = await this.db
      .from("user_tenants")
      .upsert(rows, { onConflict: "user_id,tenant_id" });

    if (error) throw new Error(error.message);
    return { linked: rows.length };
  }
}
