import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { CreateFieldNoteDto } from "./dto/create-field-note.dto";
import { UpdateFieldNoteDto } from "./dto/update-field-note.dto";

export interface FieldNoteFilters {
  tenantId?:  string;
  farmId?:    string;
  fieldId?:   string;
  seasonId?:  string;
  type?:      string;
  severity?:  string;
  resolved?:  boolean;
  dateFrom?:  string;
  dateTo?:    string;
  page?:      number;
  limit?:     number;
}

@Injectable()
export class FieldNotesService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(filters: FieldNoteFilters) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let q = this.db
      .from("field_notes_summary")
      .select("*", { count: "exact" })
      .order("observed_at", { ascending: false })
      .range(from, from + limit - 1);

    if (filters.tenantId)             q = q.eq("tenant_id", filters.tenantId);
    if (filters.farmId)               q = q.eq("farm_id",   filters.farmId);
    if (filters.fieldId)              q = q.eq("field_id",  filters.fieldId);
    if (filters.seasonId)             q = q.eq("season_id", filters.seasonId);
    if (filters.type)                 q = q.eq("type",      filters.type);
    if (filters.severity)             q = q.eq("severity",  filters.severity);
    if (filters.resolved !== undefined) q = q.eq("resolved", filters.resolved);
    if (filters.dateFrom)             q = q.gte("observed_at", filters.dateFrom);
    if (filters.dateTo)               q = q.lte("observed_at", filters.dateTo + "T23:59:59");

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return {
      data: data ?? [],
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("field_notes_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Registro não encontrado");
    return data;
  }

  async create(dto: CreateFieldNoteDto, userId?: string) {
    const { data, error } = await this.db
      .from("field_notes")
      .insert({
        tenant_id:          dto.tenantId,
        farm_id:            dto.farmId,
        field_id:           dto.fieldId,
        season_id:          dto.seasonId,
        type:               dto.type            ?? "observation",
        severity:           dto.severity,
        title:              dto.title,
        observed_at:        dto.observedAt      ?? new Date().toISOString(),
        lat:                dto.lat,
        lng:                dto.lng,
        location_desc:      dto.locationDesc,
        phenology_stage:    dto.phenologyStage,
        bbch_code:          dto.bbchCode,
        organism_name:      dto.organismName,
        infestation_pct:    dto.infestationPct,
        incidence_pct:      dto.incidencePct,
        severity_desc:      dto.severityDesc,
        recommendation:     dto.recommendation,
        deadline_at:        dto.deadlineAt,
        resolved:           dto.resolved        ?? false,
        description:        dto.description,
        images:             dto.images          ?? [],
        author_id:          dto.authorId,
        author_name:        dto.authorName,
        author_role:        dto.authorRole,
        tags:               dto.tags            ?? [],
        linked_activity_id: dto.linkedActivityId,
        created_by:         userId,
      })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateFieldNoteDto, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      type:"type", severity:"severity", title:"title",
      observedAt:"observed_at", lat:"lat", lng:"lng",
      locationDesc:"location_desc", phenologyStage:"phenology_stage",
      bbchCode:"bbch_code", organismName:"organism_name",
      infestationPct:"infestation_pct", incidencePct:"incidence_pct",
      severityDesc:"severity_desc", recommendation:"recommendation",
      deadlineAt:"deadline_at", resolved:"resolved",
      description:"description", images:"images",
      authorName:"author_name", authorRole:"author_role",
      tags:"tags", fieldId:"field_id", seasonId:"season_id",
      linkedActivityId:"linked_activity_id",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((dto as any)[k] !== undefined) updates[col] = (dto as any)[k];
    }
    const { data, error } = await this.db
      .from("field_notes").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resolve(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db
      .from("field_notes")
      .update({ resolved: true })
      .eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, resolved: true };
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("field_notes").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Registro removido" };
  }

  async getStats(farmId: string, tenantId?: string) {
    let q = this.db
      .from("field_notes_summary")
      .select("type, severity, resolved, deadline_status")
      .eq("farm_id", farmId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q;
    const all = data ?? [];
    return {
      total:        all.length,
      open:         all.filter((n:any) => !n.resolved).length,
      resolved:     all.filter((n:any) =>  n.resolved).length,
      overdue:      all.filter((n:any) => n.deadline_status === "overdue").length,
      urgent:       all.filter((n:any) => n.deadline_status === "urgent").length,
      critical:     all.filter((n:any) => n.severity === "critical" && !n.resolved).length,
      high:         all.filter((n:any) => n.severity === "high"     && !n.resolved).length,
      by_type:      this.group(all, "type"),
      by_severity:  this.group(all.filter((n:any) => n.severity), "severity"),
    };
  }

  private group(arr: any[], key: string): Record<string, number> {
    return arr.reduce((acc, i) => {
      const k = i[key] ?? "outros"; acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {});
  }
}
