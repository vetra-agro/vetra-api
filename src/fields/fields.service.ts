import {
  Injectable, NotFoundException, BadRequestException,
} from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateFieldDto } from "./dto/create-field.dto";
import { UpdateFieldDto } from "./dto/update-field.dto";

@Injectable()
export class FieldsService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(farmId: string, tenantId?: string) {
    let q = this.db
      .from("fields")
      .select(`
        id, farm_id, tenant_id, name, code, status, active,
        crop, crops, area_ha, color, soil_type, slope_pct,
        altitude_m, irrigation, current_season, geometry,
        perimeter_m, notes, tags, created_at, updated_at
      `)
      .eq("farm_id", farmId)
      .eq("active", true)
      .order("name");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("fields").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Talhão não encontrado");
    return data;
  }

  async create(dto: CreateFieldDto, userId?: string) {
    // Monta boundary WKT a partir de GeoJSON coords se enviado
    let boundaryWkt: string | null = null;
    if (dto.boundaryCoords && dto.boundaryCoords.length >= 3) {
      const coords = dto.boundaryCoords.map(([lng, lat]) => `${lng} ${lat}`).join(",");
      const [flng, flat] = dto.boundaryCoords[0];
      boundaryWkt = `POLYGON((${coords},${flng} ${flat}))`;
    }

    const { data, error } = await this.db
      .from("fields")
      .insert({
        farm_id:       dto.farmId,
        tenant_id:     dto.tenantId,
        name:          dto.name,
        code:          dto.code,
        status:        dto.status      ?? "active",
        color:         dto.color,
        crop:          dto.crops?.[0],   // compatibilidade coluna antiga
        crops:         dto.crops        ?? [],
        area_ha:       dto.areaHa,
        soil_type:     dto.soilType,
        slope_pct:     dto.slopePct,
        altitude_m:    dto.altitudeM,
        irrigation:    dto.irrigation   ?? "none",
        current_season:dto.currentSeason,
        // geometry JSONB (compatibilidade MapLibre)
        geometry:      dto.boundaryCoords ? {
          type: "Polygon",
          coordinates: [
            [...dto.boundaryCoords, dto.boundaryCoords[0]],
          ],
        } : null,
        boundary:      boundaryWkt,      // PostGIS nativo
        notes:         dto.notes,
        tags:          dto.tags         ?? [],
        created_by:    userId,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateFieldDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    let boundaryWkt: string | undefined;
    if (dto.boundaryCoords && dto.boundaryCoords.length >= 3) {
      const coords = dto.boundaryCoords.map(([lng, lat]) => `${lng} ${lat}`).join(",");
      const [flng, flat] = dto.boundaryCoords[0];
      boundaryWkt = `POLYGON((${coords},${flng} ${flat}))`;
    }

    const updates: Record<string, any> = {};
    const map: Record<string,string> = {
      name:"name", code:"code", status:"status", color:"color",
      soilType:"soil_type", slopePct:"slope_pct", altitudeM:"altitude_m",
      irrigation:"irrigation", currentSeason:"current_season",
      areaHa:"area_ha", notes:"notes", tags:"tags",
    };
    for (const [k,col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    if (dto.crops) {
      updates.crops = dto.crops;
      updates.crop  = dto.crops[0] ?? null;
    }
    if (boundaryWkt) {
      updates.boundary = boundaryWkt;
      updates.geometry = {
        type:"Polygon",
        coordinates: [[...dto.boundaryCoords!, dto.boundaryCoords![0]]],
      };
    }

    const { data, error } = await this.db
      .from("fields").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async setActive(id: string, active: boolean, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db
      .from("fields").update({ active }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, active };
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("fields").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Talhão removido" };
  }

  // GeoJSON FeatureCollection para o MapLibre
  async getGeoJson(farmId: string, tenantId?: string) {
    const fields = await this.findAll(farmId, tenantId);
    return {
      type: "FeatureCollection",
      features: fields
        .filter((f: any) => f.geometry)
        .map((f: any) => ({
          type: "Feature",
          id:   f.id,
          geometry: f.geometry,
          properties: {
            id:      f.id,
            name:    f.name,
            code:    f.code,
            area_ha: f.area_ha,
            crops:   f.crops,
            status:  f.status,
            color:   f.color ?? "#4CAF50",
            season:  f.current_season,
          },
        })),
    };
  }

  async getStats(farmId: string) {
    const { data } = await this.db
      .from("fields")
      .select("area_ha, crops, status, irrigation")
      .eq("farm_id", farmId)
      .eq("active", true);
    const all = data ?? [];
    return {
      total:         all.length,
      total_area_ha: all.reduce((s:number,f:any)=>s+(+f.area_ha||0),0),
      by_status:     this.group(all,"status"),
      by_irrigation: this.group(all,"irrigation"),
      crops:         all.flatMap((f:any)=>f.crops??[]).reduce((acc:any,c:string)=>{
                       acc[c]=(acc[c]??0)+1; return acc; },{}),
    };
  }

  private group(arr:any[],key:string):Record<string,number> {
    return arr.reduce((acc,i)=>{
      const k=i[key]??"outros"; acc[k]=(acc[k]??0)+1; return acc;
    },{});
  }
}
