import { Injectable, NotFoundException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class CompaniesService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Lista todas as empresas com resumo de licença, usuários e fazendas ────
  async findAll(search?: string) {
    let query = this.db
      .from("tenant_license_status")
      .select("*")
      .order("tenant_name");

    if (search) query = query.ilike("tenant_name", `%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Para cada tenant, busca contagem de usuários e fazendas
    const enriched = await Promise.all(
      (data ?? []).map(async (tenant: any) => {
        const [usersRes, farmsRes] = await Promise.all([
          this.db.from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("active", true),
          this.db.from("farms")
            .select("id", { count: "exact", head: true }),
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

  // ── Detalhe de uma empresa ────────────────────────────────────────────────
  async findOne(tenantId: string) {
    const { data: tenant, error } = await this.db
      .from("tenant_license_status")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();
    if (error || !tenant) throw new NotFoundException("Empresa não encontrada");

    // Usuários vinculados
    const { data: users } = await this.db
      .from("profiles")
      .select("id, full_name, email, role, active, created_at, last_sign_in_at")
      .eq("active", true)
      .order("full_name");

    // Fazendas vinculadas
    const { data: farms } = await this.db
      .from("farms")
      .select("id, name, city, state, total_area_ha, created_at")
      .order("name");

    // Histórico da licença
    const { data: history } = await this.db
      .from("license_history")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10);

    return { ...tenant, users: users ?? [], farms: farms ?? [], history: history ?? [] };
  }

  // ── Atualizar dados da empresa (tenant) ───────────────────────────────────
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

  // ── KPIs gerais ───────────────────────────────────────────────────────────
  async getStats() {
    const [tenantsRes, usersRes, farmsRes] = await Promise.all([
      this.db.from("tenant_license_status").select("status, plan"),
      this.db.from("profiles").select("active").eq("active", true),
      this.db.from("farms").select("id"),
    ]);

    const tenants = tenantsRes.data ?? [];
    return {
      total_companies:  tenants.length,
      active_companies: tenants.filter((t: any) => t.status === "active").length,
      trial_companies:  tenants.filter((t: any) => t.status === "trial").length,
      total_users:      usersRes.count ?? (usersRes.data?.length ?? 0),
      total_farms:      farmsRes.data?.length ?? 0,
      by_plan: {
        start:      tenants.filter((t: any) => t.plan === "start").length,
        growth:     tenants.filter((t: any) => t.plan === "growth").length,
        pro:        tenants.filter((t: any) => t.plan === "pro").length,
        enterprise: tenants.filter((t: any) => t.plan === "enterprise").length,
      },
    };
  }
}
