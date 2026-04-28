import {
  Injectable, NotFoundException, BadRequestException,
} from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateSeasonDto } from "./dto/create-season.dto";
import { UpdateSeasonDto } from "./dto/update-season.dto";

@Injectable()
export class SeasonsService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(farmId: string, tenantId?: string, status?: string) {
    let q = this.db
      .from("seasons_summary")
      .select("*")
      .eq("farm_id", farmId)
      .order("planting_start", { ascending: false, nullsFirst: false });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (status)   q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findAllByTenant(tenantId: string, status?: string) {
    let q = this.db
      .from("seasons_summary")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("planting_start", { ascending: false, nullsFirst: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("seasons_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Safra não encontrada");
    return data;
  }

  async create(dto: CreateSeasonDto, userId?: string) {
    const { data, error } = await this.db
      .from("seasons")
      .insert({
        tenant_id:              dto.tenantId,
        farm_id:                dto.farmId,
        name:                   dto.name,
        code:                   dto.code,
        type:                   dto.type             ?? "summer",
        status:                 dto.status           ?? "planning",
        crop:                   dto.crop,
        variety:                dto.variety,
        planting_start:         dto.plantingStart,
        planting_end:           dto.plantingEnd,
        harvest_start:          dto.harvestStart,
        harvest_end:            dto.harvestEnd,
        cycle_days:             dto.cycleDays,
        total_area_ha:          dto.totalAreaHa,
        planted_area_ha:        dto.plantedAreaHa,
        harvested_area_ha:      dto.harvestedAreaHa,
        expected_yield_sc_ha:   dto.expectedYieldScHa,
        actual_yield_sc_ha:     dto.actualYieldScHa,
        expected_production_sc: dto.expectedProductionSc,
        actual_production_sc:   dto.actualProductionSc,
        unit:                   dto.unit             ?? "sc60",
        expected_revenue:       dto.expectedRevenue,
        actual_revenue:         dto.actualRevenue,
        expected_cost_ha:       dto.expectedCostHa,
        actual_cost_ha:         dto.actualCostHa,
        price_per_unit:         dto.pricePerUnit,
        rainfall_mm:            dto.rainfallMm,
        avg_temp_c:             dto.avgTempC,
        field_ids:              dto.fieldIds          ?? [],
        notes:                  dto.notes,
        tags:                   dto.tags              ?? [],
        created_by:             userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateSeasonDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", code:"code", type:"type", status:"status",
      crop:"crop", variety:"variety",
      plantingStart:"planting_start", plantingEnd:"planting_end",
      harvestStart:"harvest_start", harvestEnd:"harvest_end",
      cycleDays:"cycle_days",
      totalAreaHa:"total_area_ha", plantedAreaHa:"planted_area_ha",
      harvestedAreaHa:"harvested_area_ha",
      expectedYieldScHa:"expected_yield_sc_ha",
      actualYieldScHa:"actual_yield_sc_ha",
      expectedProductionSc:"expected_production_sc",
      actualProductionSc:"actual_production_sc",
      unit:"unit",
      expectedRevenue:"expected_revenue", actualRevenue:"actual_revenue",
      expectedCostHa:"expected_cost_ha", actualCostHa:"actual_cost_ha",
      pricePerUnit:"price_per_unit",
      rainfallMm:"rainfall_mm", avgTempC:"avg_temp_c",
      fieldIds:"field_ids", notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("seasons").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async setStatus(id: string, status: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db
      .from("seasons").update({ status }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, status };
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("seasons").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Safra removida" };
  }

  async getStats(tenantId: string) {
    const { data } = await this.db
      .from("seasons_summary")
      .select("status, crop, type, total_area_ha, planted_area_ha, actual_yield_sc_ha, expected_yield_sc_ha, farm_name")
      .eq("tenant_id", tenantId);
    const all = data ?? [];
    const active = all.filter((s:any) => !["finished","cancelled"].includes(s.status));
    return {
      total:           all.length,
      active:          active.length,
      planning:        all.filter((s:any) => s.status === "planning").length,
      planting:        all.filter((s:any) => s.status === "planting").length,
      growing:         all.filter((s:any) => s.status === "growing").length,
      harvesting:      all.filter((s:any) => s.status === "harvesting").length,
      finished:        all.filter((s:any) => s.status === "finished").length,
      total_area_ha:   active.reduce((s:number,r:any)=>s+(+r.total_area_ha||0),0),
      planted_area_ha: active.reduce((s:number,r:any)=>s+(+r.planted_area_ha||0),0),
      by_crop:         this.group(all,"crop"),
      by_type:         this.group(all,"type"),
    };
  }

  private group(arr:any[], key:string):Record<string,number> {
    return arr.reduce((acc,i)=>{ const k=i[key]??"outros"; acc[k]=(acc[k]??0)+1; return acc; },{});
  }
}
