import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateFuelSupplyDto } from "./dto/create-fuel-supply.dto";
import { UpdateFuelSupplyDto } from "./dto/update-fuel-supply.dto";
import { CreateFuelTankDto } from "./dto/create-fuel-tank.dto";

@Injectable()
export class FuelService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Tanques ───────────────────────────────────────────────────────────────
  async getTanks(farmId: string, tenantId?: string) {
    let q = this.db.from("fuel_tanks").select("*").eq("farm_id", farmId).eq("active", true).order("name");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createTank(dto: CreateFuelTankDto) {
    const { data, error } = await this.db.from("fuel_tanks").insert({
      tenant_id:    dto.tenantId, farm_id:     dto.farmId,
      name:         dto.name,     fuel_type:   dto.fuelType,
      capacity_l:   dto.capacityL, min_level_l: dto.minLevelL,
      location_desc:dto.locationDesc,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Abastecimentos ────────────────────────────────────────────────────────
  async findAll(filters: {
    tenantId?: string; farmId?: string; machineryId?: string;
    fuelType?: string; seasonId?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let q = this.db
      .from("fuel_supplies_summary")
      .select("*", { count: "exact" })
      .order("supplied_at", { ascending: false })
      .range(from, from + limit - 1);

    if (filters.tenantId)   q = q.eq("tenant_id",   filters.tenantId);
    if (filters.farmId)     q = q.eq("farm_id",      filters.farmId);
    if (filters.machineryId)q = q.eq("machinery_id", filters.machineryId);
    if (filters.fuelType)   q = q.eq("fuel_type",    filters.fuelType);
    if (filters.seasonId)   q = q.eq("season_id",    filters.seasonId);
    if (filters.dateFrom)   q = q.gte("supplied_at", filters.dateFrom);
    if (filters.dateTo)     q = q.lte("supplied_at", filters.dateTo + "T23:59:59");

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return {
      data: data ?? [],
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("fuel_supplies_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Abastecimento não encontrado");
    return data;
  }

  async create(dto: CreateFuelSupplyDto, userId?: string) {
    const { data, error } = await this.db
      .from("fuel_supplies")
      .insert({
        tenant_id:     dto.tenantId,
        farm_id:       dto.farmId,
        tank_id:       dto.tankId,
        machinery_id:  dto.machineryId,
        season_id:     dto.seasonId,
        fuel_type:     dto.fuelType     ?? "diesel",
        source:        dto.source       ?? "farm_tank",
        supplied_at:   dto.suppliedAt   ?? new Date().toISOString(),
        quantity_l:    dto.quantityL,
        price_per_l:   dto.pricePerL,
        total_cost:    dto.totalCost,
        hourmeter:     dto.hourmeter,
        odometer_km:   dto.odometerKm,
        operator_id:   dto.operatorId,
        operator_name: dto.operatorName,
        supplier_name: dto.supplierName,
        invoice_number:dto.invoiceNumber,
        batch_number:  dto.batchNumber,
        notes:         dto.notes,
        tags:          dto.tags ?? [],
        created_by:    userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);

    // Atualiza horímetro da máquina automaticamente
    if (dto.machineryId && dto.hourmeter) {
      await this.db.from("machinery")
        .update({ hourmeter_current: dto.hourmeter, ...(dto.odometerKm ? { odometer_current_km: dto.odometerKm } : {}) })
        .eq("id", dto.machineryId);
    }

    return data;
  }

  async update(id: string, dto: UpdateFuelSupplyDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      fuelType:"fuel_type", source:"source", suppliedAt:"supplied_at",
      quantityL:"quantity_l", pricePerL:"price_per_l", totalCost:"total_cost",
      hourmeter:"hourmeter", odometerKm:"odometer_km",
      operatorId:"operator_id", operatorName:"operator_name",
      supplierName:"supplier_name", invoiceNumber:"invoice_number",
      batchNumber:"batch_number", notes:"notes", tags:"tags",
      tankId:"tank_id", machineryId:"machinery_id", seasonId:"season_id",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("fuel_supplies").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("fuel_supplies").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Abastecimento removido" };
  }

  async getStats(farmId: string, tenantId?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db
      .from("fuel_supplies")
      .select("fuel_type, quantity_l, total_cost, consumption_l_h, supplied_at")
      .eq("farm_id", farmId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (dateFrom) q = q.gte("supplied_at", dateFrom);
    if (dateTo)   q = q.lte("supplied_at", dateTo + "T23:59:59");
    const { data } = await q;
    const all = data ?? [];

    const tanks = await this.getTanks(farmId, tenantId);
    const lowTanks = tanks.filter((t: any) => t.min_level_l && t.current_l <= t.min_level_l);

    return {
      total_records:  all.length,
      total_quantity_l: all.reduce((s: number, r: any) => s + (+r.quantity_l || 0), 0),
      total_cost:       all.reduce((s: number, r: any) => s + (+r.total_cost  || 0), 0),
      avg_consumption_l_h: (() => {
        const with_h = all.filter((r: any) => r.consumption_l_h);
        if (!with_h.length) return null;
        return with_h.reduce((s: number, r: any) => s + +r.consumption_l_h, 0) / with_h.length;
      })(),
      by_fuel_type:   this.group(all, "fuel_type"),
      tanks,
      low_tanks:      lowTanks.length,
    };
  }

  private group(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, i) => {
      const k = i[key] ?? "outros"; acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {});
  }
}
