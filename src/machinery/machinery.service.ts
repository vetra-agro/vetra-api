import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateMachineryDto } from "./dto/create-machinery.dto";
import { UpdateMachineryDto } from "./dto/update-machinery.dto";

@Injectable()
export class MachineryService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(tenantId: string, filters?: {
    farmId?: string; status?: string; type?: string; search?: string;
  }) {
    let q = this.db
      .from("machinery_summary")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");
    if (filters?.farmId) q = q.eq("farm_id", filters.farmId);
    if (filters?.status) q = q.eq("status",  filters.status);
    if (filters?.type)   q = q.eq("type",    filters.type);
    if (filters?.search) q = q.or(
      `name.ilike.%${filters.search}%,brand.ilike.%${filters.search}%,model.ilike.%${filters.search}%,fleet_number.ilike.%${filters.search}%,serial_number.ilike.%${filters.search}%`
    );
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("machinery_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Equipamento não encontrado");
    return data;
  }

  async create(dto: CreateMachineryDto, userId?: string) {
    const { data, error } = await this.db
      .from("machinery")
      .insert({
        tenant_id:              dto.tenantId,
        farm_id:                dto.farmId,
        name:                   dto.name,
        type:                   dto.type              ?? "tractor",
        status:                 dto.status            ?? "active",
        brand:                  dto.brand,
        model:                  dto.model,
        model_year:             dto.modelYear,
        manufacture_year:       dto.manufactureYear,
        serial_number:          dto.serialNumber,
        license_plate:          dto.licensePlate,
        color:                  dto.color,
        fleet_number:           dto.fleetNumber,
        asset_id:               dto.assetId,
        asset_value:            dto.assetValue,
        acquisition_date:       dto.acquisitionDate,
        acquisition_doc:        dto.acquisitionDoc,
        fuel_type:              dto.fuelType          ?? "diesel",
        engine_power_hp:        dto.enginePowerHp,
        engine_model:           dto.engineModel,
        working_width_m:        dto.workingWidthM,
        tank_capacity_l:        dto.tankCapacityL,
        weight_kg:              dto.weightKg,
        hourmeter_current:      dto.hourmeterCurrent,
        odometer_current_km:    dto.odometerCurrentKm,
        hourmeter_at_purchase:  dto.hourmeterAtPurchase,
        avg_consumption_l_h:    dto.avgConsumptionLH,
        next_service_h:         dto.nextServiceH,
        next_service_km:        dto.nextServiceKm,
        next_service_date:      dto.nextServiceDate,
        last_service_h:         dto.lastServiceH,
        last_service_date:      dto.lastServiceDate,
        current_field_id:       dto.currentFieldId,
        location_notes:         dto.locationNotes,
        operator_id:            dto.operatorId,
        operator_name:          dto.operatorName,
        parent_id:              dto.parentId,
        insurance_policy:       dto.insurancePolicy,
        insurance_expiry:       dto.insuranceExpiry,
        crvl_expiry:            dto.crvlExpiry,
        antt_number:            dto.anttNumber,
        notes:                  dto.notes,
        tags:                   dto.tags              ?? [],
        created_by:             userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateMachineryDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", type:"type", status:"status", brand:"brand",
      model:"model", modelYear:"model_year", manufactureYear:"manufacture_year",
      serialNumber:"serial_number", licensePlate:"license_plate",
      color:"color", fleetNumber:"fleet_number",
      assetId:"asset_id", assetValue:"asset_value",
      acquisitionDate:"acquisition_date", acquisitionDoc:"acquisition_doc",
      fuelType:"fuel_type", enginePowerHp:"engine_power_hp",
      engineModel:"engine_model", workingWidthM:"working_width_m",
      tankCapacityL:"tank_capacity_l", weightKg:"weight_kg",
      hourmeterCurrent:"hourmeter_current", odometerCurrentKm:"odometer_current_km",
      hourmeterAtPurchase:"hourmeter_at_purchase", avgConsumptionLH:"avg_consumption_l_h",
      nextServiceH:"next_service_h", nextServiceKm:"next_service_km",
      nextServiceDate:"next_service_date", lastServiceH:"last_service_h",
      lastServiceDate:"last_service_date", currentFieldId:"current_field_id",
      locationNotes:"location_notes", operatorId:"operator_id",
      operatorName:"operator_name", parentId:"parent_id",
      insurancePolicy:"insurance_policy", insuranceExpiry:"insurance_expiry",
      crvlExpiry:"crvl_expiry", anttNumber:"antt_number",
      notes:"notes", tags:"tags", farmId:"farm_id",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("machinery").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Atualizar horímetro/odômetro rapidamente
  async updateMeters(id: string, dto: {
    hourmeterCurrent?: number; odometerCurrentKm?: number; tenantId?: string;
  }) {
    await this.findOne(id, dto.tenantId);
    const updates: any = {};
    if (dto.hourmeterCurrent  !== undefined) updates.hourmeter_current   = dto.hourmeterCurrent;
    if (dto.odometerCurrentKm !== undefined) updates.odometer_current_km = dto.odometerCurrentKm;
    const { error } = await this.db
      .from("machinery").update(updates).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, ...updates };
  }

  async setStatus(id: string, status: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db
      .from("machinery").update({ status }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, status };
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("machinery").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Equipamento removido" };
  }

  async getStats(tenantId: string) {
    const { data } = await this.db
      .from("machinery_summary")
      .select("type, status, fuel_type, alert_count, engine_power_hp, asset_value")
      .eq("tenant_id", tenantId);
    const all = data ?? [];
    return {
      total:           all.length,
      active:          all.filter((m:any)=>m.status==="active").length,
      in_maintenance:  all.filter((m:any)=>m.status==="maintenance").length,
      idle:            all.filter((m:any)=>m.status==="idle").length,
      with_alerts:     all.filter((m:any)=>m.alert_count>0).length,
      total_power_hp:  all.reduce((s:number,m:any)=>s+(+m.engine_power_hp||0),0),
      total_value:     all.reduce((s:number,m:any)=>s+(+m.asset_value||0),0),
      by_type:         this.group(all,"type"),
      by_fuel:         this.group(all,"fuel_type"),
      by_status:       this.group(all,"status"),
    };
  }

  private group(arr:any[],key:string):Record<string,number>{
    return arr.reduce((acc,i)=>{const k=i[key]??"outros";acc[k]=(acc[k]??0)+1;return acc;},{});
  }
}
