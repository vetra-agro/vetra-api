import { Injectable, NotFoundException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class CompaniesService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  async findAll(search?: string) {
    let query = this.db
      .from("tenant_license_status")
      .select("*")
      .order("tenant_name");

    if (search) query = query.ilike("tenant_name", `%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Enriquece com contagens via queries separadas
    const enriched = await Promise.all(
      (data ?? []).map(async (tenant: any) => {
        const [usersRes, farmsRes] = await Promise.all([
          this.db
            .from("user_tenants")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.tenant_id)
            .eq("active", true),
          this.db
            .from("farms")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.tenant_id),
        ]);
        return {
          ...tenant,
          users_count: usersRes.count ?? 0,
          farms_count: farmsRes.count ?? 0,
        };
      })
    );

    return enriched;
  }

  async findOne(tenantId: string) {
    const { data: tenant, error } = await this.db
      .from("tenant_license_status")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();
    if (error || !tenant) throw new NotFoundException("Empresa não encontrada");

    // Usuários: busca vínculos e perfis separadamente
    const { data: links } = await this.db
      .from("user_tenants")
      .select("id, user_id, role, is_default, active, accepted_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    let users: any[] = [];
    if (links && links.length > 0) {
      const userIds = links.map((l: any) => l.user_id).filter(Boolean);
      const { data: profiles } = await this.db
        .from("profiles")
        .select("id, full_name, email, role")
        .in("id", userIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

      users = links.map((link: any) => {
        const profile = profileMap.get(link.user_id);
        return {
          id:           link.id,
          user_id:      link.user_id,
          role:         link.role,
          is_default:   link.is_default,
          active:       link.active,
          accepted_at:  link.accepted_at,
          // Campos de perfil nivelados (como o componente espera)
          full_name:    profile?.full_name ?? "Usuário sem perfil",
          email:        profile?.email     ?? null,
          last_sign_in_at: null,
        };
      });
    }

    // Fazendas
    const { data: farms } = await this.db
      .from("farms")
      .select("id, name, city, state, total_area_ha, created_at")
      .eq("tenant_id", tenantId)
      .order("name");

    // Histórico da licença
    const { data: history } = await this.db
      .from("license_history")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      ...tenant,
      users:   users,
      farms:   farms  ?? [],
      history: history ?? [],
    };
  }

  async update(tenantId: string, dto: {
    name?: string; email?: string; phone?: string;
    city?: string; state?: string; document?: string;
  }) {
    const { data, error } = await this.db
      .from("tenants")
      .update(dto)
      .eq("id", tenantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getStats() {
    const [tenantsRes, usersRes, farmsRes] = await Promise.all([
      this.db.from("tenant_license_status").select("status, plan"),
      this.db.from("user_tenants").select("id", { count: "exact", head: true }).eq("active", true),
      this.db.from("farms").select("id", { count: "exact", head: true }),
    ]);

    const tenants = tenantsRes.data ?? [];
    return {
      total_companies:  tenants.length,
      active_companies: tenants.filter((t: any) => t.status === "active").length,
      trial_companies:  tenants.filter((t: any) => t.status === "trial").length,
      total_users:      usersRes.count ?? 0,
      total_farms:      farmsRes.count ?? 0,
      by_plan: {
        start:      tenants.filter((t: any) => t.plan === "start").length,
        growth:     tenants.filter((t: any) => t.plan === "growth").length,
        pro:        tenants.filter((t: any) => t.plan === "pro").length,
        enterprise: tenants.filter((t: any) => t.plan === "enterprise").length,
      },
    };
  }
}
