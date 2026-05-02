import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreatePhytoDto } from "./dto/create-phyto.dto";
import { UpdatePhytoDto } from "./dto/update-phyto.dto";

@Injectable()
export class PhytoService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(filters: {
    tenantId?: string; farmId?: string; seasonId?: string;
    dateFrom?: string; dateTo?: string;
    page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let q = this.db
      .from("phyto_summary")
      .select("*", { count: "exact" })
      .order("applied_at", { ascending: false })
      .range(from, from + limit - 1);

    if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
    if (filters.farmId)   q = q.eq("farm_id",   filters.farmId);
    if (filters.seasonId) q = q.eq("season_id", filters.seasonId);
    if (filters.dateFrom) q = q.gte("applied_at", filters.dateFrom);
    if (filters.dateTo)   q = q.lte("applied_at", filters.dateTo + "T23:59:59");

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return {
      data: data ?? [],
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("phyto_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Aplicação não encontrada");
    return data;
  }

  async create(dto: CreatePhytoDto, userId?: string) {
    const { data, error } = await this.db
      .from("phytosanitary_applications")
      .insert({
        tenant_id:           dto.tenantId,
        farm_id:             dto.farmId,
        season_id:           dto.seasonId,
        field_note_id:       dto.fieldNoteId,
        activity_id:         dto.activityId,
        method:              dto.method           ?? "ground_boom",
        applied_at:          dto.appliedAt,
        finished_at:         dto.finishedAt,
        field_ids:           dto.fieldIds         ?? [],
        area_ha:             dto.areaHa,
        machinery_id:        dto.machineryId,
        machinery_name:      dto.machineryName,
        nozzle_type:         dto.nozzleType,
        nozzle_spacing_m:    dto.nozzleSpacingM,
        pressure_bar:        dto.pressureBar,
        volume_ha_l:         dto.volumeHaL,
        total_volume_l:      dto.totalVolumeL,
        speed_kmh:           dto.speedKmh,
        height_m:            dto.heightM,
        operator_id:         dto.operatorId,
        operator_name:       dto.operatorName,
        agronomist_name:     dto.agronomistName,
        agronomist_crea:     dto.agronomistCrea,
        products:            dto.products         ?? [],
        temp_c:              dto.tempC,
        humidity_pct:        dto.humidityPct,
        wind_speed_kmh:      dto.windSpeedKmh,
        wind_dir:            dto.windDir,
        cloud_cover_pct:     dto.cloudCoverPct,
        condition_ok:        dto.conditionOk      ?? true,
        condition_notes:     dto.conditionNotes,
        prescription_number: dto.prescriptionNumber,
        invoice_number:      dto.invoiceNumber,
        batch_number:        dto.batchNumber,
        reentry_date:        dto.reentryDate,
        efficacy_pct:        dto.efficacyPct,
        efficacy_notes:      dto.efficacyNotes,
        efficacy_at:         dto.efficacyAt,
        product_cost:        dto.productCost,
        service_cost:        dto.serviceCost,
        notes:               dto.notes,
        tags:                dto.tags             ?? [],
        created_by:          userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdatePhytoDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      method:"method", appliedAt:"applied_at", finishedAt:"finished_at",
      fieldIds:"field_ids", areaHa:"area_ha",
      machineryId:"machinery_id", machineryName:"machinery_name",
      nozzleType:"nozzle_type", nozzleSpacingM:"nozzle_spacing_m",
      pressureBar:"pressure_bar", volumeHaL:"volume_ha_l",
      totalVolumeL:"total_volume_l", speedKmh:"speed_kmh", heightM:"height_m",
      operatorId:"operator_id", operatorName:"operator_name",
      agronomistName:"agronomist_name", agronomistCrea:"agronomist_crea",
      products:"products",
      tempC:"temp_c", humidityPct:"humidity_pct", windSpeedKmh:"wind_speed_kmh",
      windDir:"wind_dir", cloudCoverPct:"cloud_cover_pct",
      conditionOk:"condition_ok", conditionNotes:"condition_notes",
      prescriptionNumber:"prescription_number", invoiceNumber:"invoice_number",
      batchNumber:"batch_number", reentryDate:"reentry_date",
      efficacyPct:"efficacy_pct", efficacyNotes:"efficacy_notes", efficacyAt:"efficacy_at",
      productCost:"product_cost", serviceCost:"service_cost",
      seasonId:"season_id", notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("phytosanitary_applications").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("phytosanitary_applications").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Aplicação removida" };
  }

  async getStats(farmId: string, tenantId?: string, seasonId?: string) {
    let q = this.db
      .from("phyto_summary")
      .select("method, area_ha, total_cost, products_count, withholding_active, condition_ok, applied_at")
      .eq("farm_id", farmId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data } = await q;
    const all = data ?? [];
    return {
      total:              all.length,
      total_area_ha:      all.reduce((s: number, a: any) => s + (+a.area_ha || 0), 0),
      total_cost:         all.reduce((s: number, a: any) => s + (+a.total_cost || 0), 0),
      total_products:     all.reduce((s: number, a: any) => s + (+a.products_count || 0), 0),
      withholding_active: all.filter((a: any) => a.withholding_active).length,
      off_label:          all.filter((a: any) => !a.condition_ok).length,
      by_method:          this.group(all, "method"),
    };
  }

  private group(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, i) => {
      const k = i[key] ?? "outros"; acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {});
  }
}
