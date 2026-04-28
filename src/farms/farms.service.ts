import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateFarmDto } from "./dto/create-farm.dto";
import { UpdateFarmDto } from "./dto/update-farm.dto";

export interface FarmFilters {
  tenantId?: string;
  status?:   string;
  state?:    string;
  search?:   string;
  biome?:    string;
}

@Injectable()
export class FarmsService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Verificar limite de fazendas do plano ────────────────────────────────
  private async checkFarmLimit(tenantId: string) {
    const { data: license } = await this.db
      .from("licenses")
      .select("max_farms")
      .eq("tenant_id", tenantId)
      .single();

    if (!license) throw new ForbiddenException("Licença não encontrada");
    if (license.max_farms === -1) return; // ilimitado (Pro/Enterprise)

    const { count } = await this.db
      .from("farms")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active");

    if ((count ?? 0) >= license.max_farms) {
      throw new ForbiddenException(
        `Limite de ${license.max_farms} fazenda(s) atingido. Faça upgrade do plano.`
      );
    }
  }

  // ── Listar fazendas ───────────────────────────────────────────────────────
  async findAll(filters: FarmFilters) {
    let query = this.db
      .from("farms")
      .select(`
        id, tenant_id, name, trade_name, status, biome,
        state, city, total_area_ha, useful_area_ha,
        latitude, longitude,
        car_number, car_status,
        main_crops, main_livestock,
        has_electricity, has_internet, internet_type,
        has_storage, storage_capacity_ton,
        manager_name, manager_phone, manager_email,
        owner_name, tags, created_at, updated_at
      `)
      .order("name");

    if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
    if (filters.status)   query = query.eq("status",    filters.status);
    if (filters.state)    query = query.eq("state",     filters.state);
    if (filters.biome)    query = query.eq("biome",     filters.biome);
    if (filters.search)   query = query.or(
      `name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,car_number.ilike.%${filters.search}%`
    );

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Detalhe de uma fazenda ────────────────────────────────────────────────
  async findOne(id: string, tenantId?: string) {
    let query = this.db
      .from("farms")
      .select("*")
      .eq("id", id);

    if (tenantId) query = query.eq("tenant_id", tenantId);

    const { data, error } = await query.single();
    if (error || !data) throw new NotFoundException("Fazenda não encontrada");
    return data;
  }

  // ── Criar fazenda ─────────────────────────────────────────────────────────
  async create(dto: CreateFarmDto, userId?: string) {
    await this.checkFarmLimit(dto.tenantId);

    // Monta geometry do boundary se coordenadas de polígono forem enviadas
    let boundaryWkt: string | null = null;
    if (dto.boundaryCoords && dto.boundaryCoords.length >= 3) {
      const coords = dto.boundaryCoords
        .map(([lng, lat]) => `${lng} ${lat}`)
        .join(",");
      // Fecha o polígono repetindo o primeiro ponto
      const first = dto.boundaryCoords[0];
      boundaryWkt = `POLYGON((${coords},${first[0]} ${first[1]}))`;
    }

    const { data, error } = await this.db
      .from("farms")
      .insert({
        tenant_id:           dto.tenantId,
        name:                dto.name,
        trade_name:          dto.tradeName,
        status:              dto.status       ?? "active",
        biome:               dto.biome,
        owner_name:          dto.ownerName,
        manager_name:        dto.managerName,
        manager_phone:       dto.managerPhone,
        manager_email:       dto.managerEmail,
        state:               dto.state,
        city:                dto.city,
        district:            dto.district,
        address:             dto.address,
        zip_code:            dto.zipCode,
        latitude:            dto.latitude,
        longitude:           dto.longitude,
        altitude_m:          dto.altitudeM,
        boundary:            boundaryWkt,
        total_area_ha:       dto.totalAreaHa,
        useful_area_ha:      dto.usefulAreaHa,
        preserved_area_ha:   dto.preservedAreaHa,
        irrigated_area_ha:   dto.irrigatedAreaHa,
        car_number:          dto.carNumber,
        car_status:          dto.carStatus,
        car_area_ha:         dto.carAreaHa,
        itr_nirf:            dto.itrNirf,
        itr_area_ha:         dto.itrAreaHa,
        registry_number:     dto.registryNumber,
        registry_office:     dto.registryOffice,
        ccir_number:         dto.ccirNumber,
        incra_code:          dto.incraCode,
        has_electricity:     dto.hasElectricity     ?? false,
        has_water_supply:    dto.hasWaterSupply      ?? false,
        has_internet:        dto.hasInternet         ?? false,
        internet_type:       dto.internetType,
        has_storage:         dto.hasStorage          ?? false,
        storage_capacity_ton:dto.storageCapacityTon,
        has_fuel_station:    dto.hasFuelStation      ?? false,
        has_workshop:        dto.hasWorkshop         ?? false,
        has_housing:         dto.hasHousing          ?? false,
        housing_capacity:    dto.housingCapacity,
        has_scale:           dto.hasScale            ?? false,
        scale_capacity_ton:  dto.scaleCapacityTon,
        main_crops:          dto.mainCrops           ?? [],
        main_livestock:      dto.mainLivestock        ?? [],
        certification:       dto.certification        ?? [],
        avg_rainfall_mm:     dto.avgRainfallMm,
        avg_temp_c:          dto.avgTempC,
        frost_risk:          dto.frostRisk            ?? false,
        notes:               dto.notes,
        tags:                dto.tags                 ?? [],
        created_by:          userId,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Atualizar fazenda ─────────────────────────────────────────────────────
  async update(id: string, dto: UpdateFarmDto, tenantId?: string) {
    await this.findOne(id, tenantId); // valida existência e tenant

    let boundaryWkt: string | undefined;
    if (dto.boundaryCoords && dto.boundaryCoords.length >= 3) {
      const coords = dto.boundaryCoords.map(([lng, lat]) => `${lng} ${lat}`).join(",");
      const first  = dto.boundaryCoords[0];
      boundaryWkt  = `POLYGON((${coords},${first[0]} ${first[1]}))`;
    }

    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", tradeName:"trade_name", status:"status", biome:"biome",
      ownerName:"owner_name", managerName:"manager_name",
      managerPhone:"manager_phone", managerEmail:"manager_email",
      state:"state", city:"city", district:"district",
      address:"address", zipCode:"zip_code",
      latitude:"latitude", longitude:"longitude", altitudeM:"altitude_m",
      totalAreaHa:"total_area_ha", usefulAreaHa:"useful_area_ha",
      preservedAreaHa:"preserved_area_ha", irrigatedAreaHa:"irrigated_area_ha",
      carNumber:"car_number", carStatus:"car_status", carAreaHa:"car_area_ha",
      itrNirf:"itr_nirf", itrAreaHa:"itr_area_ha",
      registryNumber:"registry_number", registryOffice:"registry_office",
      ccirNumber:"ccir_number", incraCode:"incra_code",
      hasElectricity:"has_electricity", hasWaterSupply:"has_water_supply",
      hasInternet:"has_internet", internetType:"internet_type",
      hasStorage:"has_storage", storageCapacityTon:"storage_capacity_ton",
      hasFuelStation:"has_fuel_station", hasWorkshop:"has_workshop",
      hasHousing:"has_housing", housingCapacity:"housing_capacity",
      hasScale:"has_scale", scaleCapacityTon:"scale_capacity_ton",
      mainCrops:"main_crops", mainLivestock:"main_livestock",
      certification:"certification",
      avgRainfallMm:"avg_rainfall_mm", avgTempC:"avg_temp_c",
      frostRisk:"frost_risk", notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    if (boundaryWkt) updates.boundary = boundaryWkt;

    const { data, error } = await this.db
      .from("farms").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Arquivar / ativar fazenda ─────────────────────────────────────────────
  async setStatus(id: string, status: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db
      .from("farms").update({ status }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, status };
  }

  // ── Remover fazenda ───────────────────────────────────────────────────────
  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("farms").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Fazenda removida com sucesso" };
  }

  // ── KPIs do tenant ────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const { data } = await this.db
      .from("farms")
      .select("status, total_area_ha, useful_area_ha, state, biome, main_crops")
      .eq("tenant_id", tenantId);

    const all = data ?? [];
    const active = all.filter((f: any) => f.status === "active");

    return {
      total:           all.length,
      active:          active.length,
      inactive:        all.filter((f: any) => f.status === "inactive").length,
      total_area_ha:   active.reduce((s: number, f: any) => s + (f.total_area_ha || 0), 0),
      useful_area_ha:  active.reduce((s: number, f: any) => s + (f.useful_area_ha || 0), 0),
      by_state:        this.groupCount(active, "state"),
      by_biome:        this.groupCount(active, "biome"),
      main_crops:      this.flatGroupCount(active, "main_crops"),
    };
  }

  private groupCount(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, item) => {
      const k = item[key] ?? "outros";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  }

  private flatGroupCount(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, item) => {
      for (const v of (item[key] ?? [])) acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
  }
}
