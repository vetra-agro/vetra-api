import { Injectable, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class HistoryService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Histórico por safra ────────────────────────────────────────────────
  async getSeasonHistory(farmId: string, tenantId?: string, filters?: {
    crop?: string; status?: string; yearFrom?: number; yearTo?: number;
  }) {
    let q = this.db
      .from("season_history")
      .select("*")
      .eq("farm_id", farmId)
      .order("planting_start", { ascending: false, nullsFirst: false });

    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (filters?.crop)   q = q.eq("crop", filters.crop);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.yearFrom) q = q.gte("planting_start", `${filters.yearFrom}-01-01`);
    if (filters?.yearTo)   q = q.lte("planting_start", `${filters.yearTo}-12-31`);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Histórico por talhão ───────────────────────────────────────────────
  async getFieldHistory(farmId: string, tenantId?: string) {
    let q = this.db
      .from("field_history")
      .select("*")
      .eq("farm_id", farmId)
      .order("field_name");

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Detalhe de uma safra: atividades por tipo ──────────────────────────
  async getSeasonActivities(seasonId: string) {
    const { data, error } = await this.db
      .from("activities_summary")
      .select("type, status, area_ha, total_cost, duration_h, started_at, operator_full_name, season_name")
      .eq("season_id", seasonId)
      .order("started_at");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Detalhe de uma safra: aplicações fitossanitárias ──────────────────
  async getSeasonSprays(seasonId: string) {
    const { data, error } = await this.db
      .from("phyto_summary")
      .select("method, applied_at, area_ha, products, total_cost, efficacy_pct, products_count")
      .eq("season_id", seasonId)
      .order("applied_at");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Comparativo entre safras (mesmo crop na mesma fazenda) ─────────────
  async getCropComparison(farmId: string, crop: string, tenantId?: string) {
    let q = this.db
      .from("season_history")
      .select(`
        season_id, season_name, season_code, planting_start, harvest_end,
        planted_area_ha, actual_yield_sc_ha, expected_yield_sc_ha,
        actual_cost_ha, expected_cost_ha, gross_margin,
        rainfall_mm, avg_temp_c, activity_count, spray_count
      `)
      .eq("farm_id", farmId)
      .eq("crop", crop)
      .eq("status", "finished")
      .order("planting_start", { ascending: true });

    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── KPIs gerais da fazenda ────────────────────────────────────────────
  async getFarmKpis(farmId: string, tenantId?: string) {
    let q = this.db
      .from("season_history")
      .select("crop, actual_yield_sc_ha, gross_margin, planted_area_ha, total_cost_consolidated, status")
      .eq("farm_id", farmId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q;
    const all      = data ?? [];
    const finished = all.filter((s: any) => s.status === "finished");

    return {
      total_seasons:   all.length,
      finished_seasons:finished.length,
      total_area_farmed: finished.reduce((s: number, r: any) => s + (+r.planted_area_ha || 0), 0),
      avg_yield_sc_ha:   finished.filter((r: any) => r.actual_yield_sc_ha)
                           .reduce((s: number, r: any, _, arr) => s + (+r.actual_yield_sc_ha || 0) / arr.length, 0),
      best_yield_sc_ha:  Math.max(...finished.map((r: any) => +r.actual_yield_sc_ha || 0)),
      total_gross_margin:finished.reduce((s: number, r: any) => s + (+r.gross_margin || 0), 0),
      crops: [...new Set(all.map((r: any) => r.crop))].filter(Boolean),
    };
  }
}
