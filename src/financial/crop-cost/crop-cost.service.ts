import { Injectable, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class CropCostService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Custo consolidado de todas as safras do tenant ──────────────────────
  async findAll(tenantId: string, farmId?: string, crop?: string, status?: string) {
    let q = this.db
      .from("crop_cost_by_season")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("planting_start", { ascending: false, nullsFirst: false });

    if (farmId) q = q.eq("farm_id", farmId);
    if (crop)   q = q.eq("crop",    crop);
    if (status) q = q.eq("status",  status);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Detalhe de uma safra: breakdown por categoria de custo ──────────────
  async getDetail(seasonId: string, tenantId?: string) {
    // Dados consolidados da view
    let q = this.db.from("crop_cost_by_season").select("*").eq("season_id", seasonId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: season } = await q.single();
    if (!season) throw new BadRequestException("Safra não encontrada");

    // Atividades agrupadas por tipo
    const { data: activitiesByType } = await this.db
      .from("activities")
      .select("type, total_cost, area_ha, duration_h, started_at")
      .eq("season_id", seasonId)
      .neq("status", "cancelled")
      .order("started_at");

    // Fitossanitários agrupados por produto (top 10)
    const { data: sprays } = await this.db
      .from("phytosanitary_applications")
      .select("applied_at, area_ha, total_cost, products")
      .eq("season_id", seasonId)
      .order("applied_at");

    // Contas a pagar por categoria
    const { data: payables } = await this.db
      .from("accounts_payable")
      .select("description, amount_paid, category_id, payment_date")
      .eq("season_id", seasonId)
      .eq("status", "paid")
      .order("payment_date");

    // Combustível
    const { data: fuel } = await this.db
      .from("fuel_supplies")
      .select("fuel_type, quantity_l, total_cost, supplied_at")
      .eq("season_id", seasonId)
      .order("supplied_at");

    // Agrupa atividades por tipo
    const actByType: Record<string, { count: number; cost: number; area_ha: number }> = {};
    for (const a of (activitiesByType ?? [])) {
      if (!actByType[a.type]) actByType[a.type] = { count: 0, cost: 0, area_ha: 0 };
      actByType[a.type].count++;
      actByType[a.type].cost     += +a.total_cost   || 0;
      actByType[a.type].area_ha  += +a.area_ha       || 0;
    }

    // Agrupa combustível por tipo
    const fuelByType: Record<string, { qty_l: number; cost: number }> = {};
    for (const f of (fuel ?? [])) {
      if (!fuelByType[f.fuel_type]) fuelByType[f.fuel_type] = { qty_l: 0, cost: 0 };
      fuelByType[f.fuel_type].qty_l += +f.quantity_l || 0;
      fuelByType[f.fuel_type].cost  += +f.total_cost || 0;
    }

    // Extrai produtos fitossanitários (top gastos)
    const productCosts: Record<string, number> = {};
    for (const sp of (sprays ?? [])) {
      for (const prod of (sp.products ?? [])) {
        const name = prod.product_name ?? "Produto";
        const cost = (prod.dose_per_ha ?? 0) * (sp.area_ha ?? 0) * (prod.cost_unit ?? 0);
        productCosts[name] = (productCosts[name] ?? 0) + cost;
      }
    }
    const topProducts = Object.entries(productCosts)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 10)
      .map(([name, cost]) => ({ name, cost }));

    return {
      season,
      breakdown: {
        activities:    { total: season.cost_activities,    by_type: actByType },
        phytosanitary: { total: season.cost_phytosanitary, count: (sprays ?? []).length, top_products: topProducts },
        fuel:          { total: season.cost_fuel,          by_type: fuelByType },
        payable:       { total: season.cost_payable,       count: (payables ?? []).length },
      },
      timeline: (activitiesByType ?? []).map((a: any) => ({
        date:  a.started_at,
        type:  a.type,
        cost:  +a.total_cost || 0,
        area:  +a.area_ha    || 0,
      })),
    };
  }

  // ── Comparativo entre safras da mesma cultura ───────────────────────────
  async compareByCrop(tenantId: string, crop: string, farmId?: string) {
    let q = this.db
      .from("crop_cost_by_season")
      .select(`
        season_id, season_name, season_code, planting_start, harvest_end,
        planted_area_ha, actual_yield_sc_ha, cost_per_ha, cost_per_sc,
        cost_activities, cost_phytosanitary, cost_fuel, cost_payable,
        total_cost, gross_margin, margin_pct, breakeven_sc_ha, status
      `)
      .eq("tenant_id", tenantId)
      .eq("crop",      crop)
      .order("planting_start", { ascending: true });

    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── KPIs gerais do módulo ───────────────────────────────────────────────
  async getStats(tenantId: string, farmId?: string) {
    let q = this.db
      .from("crop_cost_by_season")
      .select("crop, total_cost, cost_per_ha, gross_margin, planted_area_ha, status")
      .eq("tenant_id", tenantId);
    if (farmId) q = q.eq("farm_id", farmId);
    const { data } = await q;
    const all      = data ?? [];
    const finished = all.filter((s: any) => s.status === "finished");

    return {
      total_seasons:      all.length,
      finished_seasons:   finished.length,
      avg_cost_per_ha:    finished.length
        ? finished.reduce((s: number, r: any) => s + (+r.cost_per_ha || 0), 0) / finished.length
        : null,
      best_margin:        Math.max(...finished.map((r: any) => +r.gross_margin || 0).filter(v => v > 0)),
      total_invested:     all.reduce((s: number, r: any) => s + (+r.total_cost || 0), 0),
      crops:              [...new Set(all.map((r: any) => r.crop).filter(Boolean))],
    };
  }
}
