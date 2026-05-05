import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class CostCentersService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(tenantId: string, farmId?: string, type?: string) {
    let q = this.db
      .from("cost_center_summary")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("active",    true)
      .order("code", { nullsFirst: false })
      .order("name");
    if (farmId) q = q.eq("farm_id", farmId);
    if (type)   q = q.eq("type",    type);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("cost_center_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Centro não encontrado");
    return data;
  }

  async create(dto: any) {
    const { data, error } = await this.db.from("cost_centers").insert({
      tenant_id:   dto.tenantId,
      farm_id:     dto.farmId,
      name:        dto.name,
      code:        dto.code,
      type:        dto.type        ?? "cost",
      parent_id:   dto.parentId,
      description: dto.description,
      budget:      dto.budget,
      budget_year: dto.budgetYear  ?? new Date().getFullYear(),
      color:       dto.color,
      active:      true,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: any, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", code:"code", type:"type", parentId:"parent_id",
      description:"description", budget:"budget", budgetYear:"budget_year",
      color:"color", active:"active", farmId:"farm_id",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db
      .from("cost_centers").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string, tenantId?: string) {
    // Soft delete
    const { error } = await this.db
      .from("cost_centers")
      .update({ active: false })
      .eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async getStats(tenantId: string) {
    const { data } = await this.db
      .from("cost_center_summary")
      .select("type, total_paid, total_received, balance, budget, budget_used_pct")
      .eq("tenant_id", tenantId)
      .eq("active",    true);
    const all = data ?? [];
    const costs   = all.filter((c: any) => c.type === "cost");
    const profits = all.filter((c: any) => c.type === "profit");
    return {
      total_centers:   all.length,
      cost_centers:    costs.length,
      profit_centers:  profits.length,
      total_expenses:  costs.reduce((s: number, c: any) => s + (+c.total_paid || 0), 0),
      total_revenue:   profits.reduce((s: number, c: any) => s + (+c.total_received || 0), 0),
      over_budget:     all.filter((c: any) => c.budget_used_pct > 100).length,
    };
  }

  // Análise de despesas por centro no período
  async getBreakdown(tenantId: string, dateFrom?: string, dateTo?: string) {
    let q = this.db
      .from("accounts_payable")
      .select("cost_center_id, amount_paid, status")
      .eq("tenant_id", tenantId)
      .eq("status",    "paid");
    if (dateFrom) q = q.gte("payment_date", dateFrom);
    if (dateTo)   q = q.lte("payment_date", dateTo);
    const { data: pays } = await q;

    let q2 = this.db
      .from("accounts_receivable")
      .select("cost_center_id, amount_received, status")
      .eq("tenant_id", tenantId)
      .eq("status",    "paid");
    if (dateFrom) q2 = q2.gte("receipt_date", dateFrom);
    if (dateTo)   q2 = q2.lte("receipt_date", dateTo);
    const { data: recs } = await q2;

    // Busca nomes dos centros
    const { data: centers } = await this.db
      .from("cost_centers")
      .select("id, name, code, type, color")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    const centerMap = new Map((centers ?? []).map((c: any) => [c.id, c]));

    // Agrupa por centro
    const result: Record<string, any> = {};
    for (const p of (pays ?? [])) {
      const id = p.cost_center_id ?? "sem_centro";
      if (!result[id]) {
        const c = centerMap.get(id);
        result[id] = {
          id, name: c?.name ?? "Sem centro", code: c?.code,
          type: c?.type ?? "cost", color: c?.color,
          total_paid: 0, total_received: 0,
        };
      }
      result[id].total_paid += (+p.amount_paid || 0);
    }
    for (const r of (recs ?? [])) {
      const id = r.cost_center_id ?? "sem_centro";
      if (!result[id]) {
        const c = centerMap.get(id);
        result[id] = {
          id, name: c?.name ?? "Sem centro", code: c?.code,
          type: c?.type ?? "profit", color: c?.color,
          total_paid: 0, total_received: 0,
        };
      }
      result[id].total_received += (+r.amount_received || 0);
    }

    return Object.values(result).sort((a: any, b: any) => b.total_paid - a.total_paid);
  }

  // Seeds de centros padrão para um novo tenant
  async seedDefaults(tenantId: string) {
    const defaults = [
      { name:"Lavoura",            code:"100", type:"cost",   color:"#4CAF50" },
      { name:"Insumos",            code:"101", type:"cost",   color:"#F44336" },
      { name:"Mão de obra",        code:"102", type:"cost",   color:"#FF9800" },
      { name:"Maquinário",         code:"103", type:"cost",   color:"#795548" },
      { name:"Combustível",        code:"104", type:"cost",   color:"#FF5722" },
      { name:"Manutenção",         code:"105", type:"cost",   color:"#9E9E9E" },
      { name:"Administrativo",     code:"200", type:"cost",   color:"#607D8B" },
      { name:"Vendas de produção", code:"300", type:"profit", color:"#2196F3" },
      { name:"Serviços prestados", code:"301", type:"profit", color:"#00BCD4" },
    ];
    const { error } = await this.db.from("cost_centers").insert(
      defaults.map(d => ({ ...d, tenant_id: tenantId, active: true }))
    );
    if (error) throw new BadRequestException(error.message);
    return { seeded: defaults.length };
  }
}
