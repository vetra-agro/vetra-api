import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateActivityDto } from "./dto/create-activity.dto";
import { UpdateActivityDto } from "./dto/update-activity.dto";

export interface ActivityFilters {
  tenantId?:  string;
  farmId?:    string;
  seasonId?:  string;
  type?:      string;
  status?:    string;
  operatorId?:string;
  dateFrom?:  string;
  dateTo?:    string;
  page?:      number;
  limit?:     number;
}

@Injectable()
export class ActivitiesService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(filters: ActivityFilters) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let q = this.db
      .from("activities_summary")
      .select("*", { count: "exact" })
      .order("started_at", { ascending: false })
      .range(from, from + limit - 1);

    if (filters.tenantId)   q = q.eq("tenant_id",   filters.tenantId);
    if (filters.farmId)     q = q.eq("farm_id",      filters.farmId);
    if (filters.seasonId)   q = q.eq("season_id",    filters.seasonId);
    if (filters.type)       q = q.eq("type",         filters.type);
    if (filters.status)     q = q.eq("status",       filters.status);
    if (filters.operatorId) q = q.eq("operator_id",  filters.operatorId);
    if (filters.dateFrom)   q = q.gte("started_at",  filters.dateFrom);
    if (filters.dateTo)     q = q.lte("started_at",  filters.dateTo + "T23:59:59");

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return {
      data: data ?? [],
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("activities_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Apontamento não encontrado");
    return data;
  }

  async create(dto: CreateActivityDto, userId?: string) {
    const { data, error } = await this.db
      .from("activities")
      .insert({
        tenant_id:            dto.tenantId,
        farm_id:              dto.farmId,
        season_id:            dto.seasonId,
        type:                 dto.type,
        status:               dto.status            ?? "done",
        name:                 dto.name,
        started_at:           dto.startedAt,
        finished_at:          dto.finishedAt,
        duration_h:           dto.durationH,
        field_ids:            dto.fieldIds           ?? [],
        area_ha:              dto.areaHa,
        machinery_ids:        dto.machineryIds       ?? [],
        hourmeter_start:      dto.hourmeterStart,
        hourmeter_end:        dto.hourmeterEnd,
        fuel_used_l:          dto.fuelUsedL,
        operator_id:          dto.operatorId,
        operator_name:        dto.operatorName,
        inputs_applied:       dto.inputsApplied      ?? [],
        production_sc:        dto.productionSc,
        production_ton:       dto.productionTon,
        moisture_pct:         dto.moisturePct,
        impurity_pct:         dto.impurityPct,
        weather_temp_c:       dto.weatherTempC,
        weather_wind_kmh:     dto.weatherWindKmh,
        weather_humidity_pct: dto.weatherHumidityPct,
        weather_condition:    dto.weatherCondition,
        labor_cost:           dto.laborCost,
        machinery_cost:       dto.machineryCost,
        input_cost:           dto.inputCost,
        notes:                dto.notes,
        tags:                 dto.tags               ?? [],
        created_by:           userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateActivityDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      type:"type", status:"status", name:"name",
      startedAt:"started_at", finishedAt:"finished_at", durationH:"duration_h",
      fieldIds:"field_ids", areaHa:"area_ha",
      machineryIds:"machinery_ids",
      hourmeterStart:"hourmeter_start", hourmeterEnd:"hourmeter_end",
      fuelUsedL:"fuel_used_l", operatorId:"operator_id", operatorName:"operator_name",
      inputsApplied:"inputs_applied",
      productionSc:"production_sc", productionTon:"production_ton",
      moisturePct:"moisture_pct", impurityPct:"impurity_pct",
      weatherTempC:"weather_temp_c", weatherWindKmh:"weather_wind_kmh",
      weatherHumidityPct:"weather_humidity_pct", weatherCondition:"weather_condition",
      laborCost:"labor_cost", machineryCost:"machinery_cost", inputCost:"input_cost",
      notes:"notes", tags:"tags", seasonId:"season_id",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("activities").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("activities").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Apontamento removido" };
  }

  async getStats(farmId: string, tenantId?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db
      .from("activities")
      .select("type, status, area_ha, total_cost, duration_h, fuel_used_l, production_sc, started_at")
      .eq("farm_id", farmId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (dateFrom) q = q.gte("started_at", dateFrom);
    if (dateTo)   q = q.lte("started_at", dateTo + "T23:59:59");
    const { data } = await q;
    const all = data ?? [];
    return {
      total:            all.length,
      total_area_ha:    all.reduce((s:number,a:any)=>s+(+a.area_ha||0),0),
      total_cost:       all.reduce((s:number,a:any)=>s+(+a.total_cost||0),0),
      total_hours:      all.reduce((s:number,a:any)=>s+(+a.duration_h||0),0),
      total_fuel_l:     all.reduce((s:number,a:any)=>s+(+a.fuel_used_l||0),0),
      total_harvest_sc: all.filter((a:any)=>a.type==="harvesting").reduce((s:number,a:any)=>s+(+a.production_sc||0),0),
      by_type:          this.group(all,"type"),
      by_status:        this.group(all,"status"),
    };
  }

  private group(arr:any[], key:string):Record<string,number>{
    return arr.reduce((acc,i)=>{ const k=i[key]??"outros"; acc[k]=(acc[k]??0)+1; return acc; },{});
  }
}
