import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class MaintenanceService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getKpis(tenantId: string) {
    const { data, error } = await this.db.from("maintenance_kpis")
      .select("*").eq("tenant_id", tenantId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ?? {};
  }

  // ── Planos de Manutenção ──────────────────────────────────────────────
  async findAllPlans(tenantId: string, machineId?: string, active = true) {
    let q = this.db.from("maintenance_plans")
      .select("*, machinery(name,model,plate), farms(name), partners(name)")
      .eq("tenant_id", tenantId).order("name");
    if (active)     q = q.eq("active", true);
    if (machineId)  q = q.eq("machinery_id", machineId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertPlan(dto: any) {
    const payload = {
      tenant_id:           dto.tenantId,
      farm_id:             dto.farmId           || null,
      machinery_id:        dto.machineryId      || null,
      supplier_id:         dto.supplierId       || null,
      name:                dto.name,
      description:         dto.description      || null,
      maintenance_type:    dto.maintenanceType  ?? "preventive",
      priority:            dto.priority         ?? "medium",
      frequency_type:      dto.frequencyType    ?? "calendar",
      frequency_value:     +dto.frequencyValue  || 30,
      estimated_hours:     dto.estimatedHours   ? +dto.estimatedHours  : null,
      estimated_cost:      dto.estimatedCost    ? +dto.estimatedCost   : null,
      responsible:         dto.responsible      || null,
      checklist_template:  dto.checklistTemplate ?? [],
      active:              dto.active           ?? true,
      notes:               dto.notes            || null,
      tags:                dto.tags             ?? [],
    };
    if (dto.id) {
      const { data, error } = await this.db.from("maintenance_plans")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("maintenance_plans")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Agendamentos ──────────────────────────────────────────────────────
  async findAllSchedules(tenantId: string, filters: {
    status?: string; machineId?: string; dateFrom?: string; dateTo?: string;
  }) {
    let q = this.db.from("maintenance_schedules")
      .select("*, maintenance_plans(name), machinery(name,model,plate), farms(name), partners(name)")
      .eq("tenant_id", tenantId).order("scheduled_date");
    if (filters.status)    q = q.eq("status",       filters.status);
    if (filters.machineId) q = q.eq("machinery_id", filters.machineId);
    if (filters.dateFrom)  q = q.gte("scheduled_date", filters.dateFrom);
    if (filters.dateTo)    q = q.lte("scheduled_date", filters.dateTo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertSchedule(dto: any) {
    const payload = {
      tenant_id:        dto.tenantId,
      plan_id:          dto.planId         || null,
      machinery_id:     dto.machineryId    || null,
      farm_id:          dto.farmId         || null,
      supplier_id:      dto.supplierId     || null,
      title:            dto.title,
      maintenance_type: dto.maintenanceType ?? "preventive",
      priority:         dto.priority        ?? "medium",
      status:           dto.status          ?? "scheduled",
      scheduled_date:   dto.scheduledDate,
      scheduled_time:   dto.scheduledTime   || null,
      estimated_hours:  dto.estimatedHours  ? +dto.estimatedHours : null,
      responsible:      dto.responsible     || null,
      meter_reading:    dto.meterReading    ? +dto.meterReading   : null,
      meter_unit:       dto.meterUnit       ?? "h",
      notes:            dto.notes           || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("maintenance_schedules")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("maintenance_schedules")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async completeSchedule(id: string, dto: {
    completedBy: string; completionNotes?: string; createOS?: boolean; tenantId: string;
  }) {
    const { data: sched } = await this.db.from("maintenance_schedules")
      .select("*").eq("id", id).single();
    if (!sched) throw new NotFoundException("Agendamento não encontrado");

    await this.db.from("maintenance_schedules").update({
      status:           "done",
      completed_at:     new Date().toISOString(),
      completed_by:     dto.completedBy,
      completion_notes: dto.completionNotes,
    }).eq("id", id);

    // Opcionalmente gera OS
    if (dto.createOS) {
      const os = await this.createWorkOrder({
        tenantId:        dto.tenantId,
        scheduleId:      id,
        machineryId:     sched.machinery_id,
        farmId:          sched.farm_id,
        title:           sched.title,
        maintenanceType: sched.maintenance_type,
        priority:        sched.priority,
        assignedTo:      dto.completedBy,
        status:          "done",
      });
      return { completed: true, workOrder: os };
    }
    return { completed: true };
  }

  // ── Ordens de Serviço ─────────────────────────────────────────────────
  async findAllWorkOrders(tenantId: string, filters: {
    status?: string; machineId?: string; priority?: string;
    page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db.from("work_orders")
      .select("*, machinery(name,model,plate), farms(name), partners(name), cost_centers(name)", { count:"exact" })
      .eq("tenant_id", tenantId)
      .order("opened_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (filters.status)    q = q.eq("status",       filters.status);
    if (filters.machineId) q = q.eq("machinery_id", filters.machineId);
    if (filters.priority)  q = q.eq("priority",     filters.priority);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async createWorkOrder(dto: any, userId?: string) {
    const { data, error } = await this.db.from("work_orders").insert({
      tenant_id:        dto.tenantId,
      schedule_id:      dto.scheduleId     || null,
      machinery_id:     dto.machineryId    || null,
      farm_id:          dto.farmId         || null,
      supplier_id:      dto.supplierId     || null,
      cost_center_id:   dto.costCenterId   || null,
      title:            dto.title,
      description:      dto.description    || null,
      maintenance_type: dto.maintenanceType ?? "corrective",
      priority:         dto.priority        ?? "medium",
      status:           dto.status          ?? "open",
      opened_at:        dto.openedAt        || new Date().toISOString().split("T")[0],
      due_date:         dto.dueDate         || null,
      assigned_to:      dto.assignedTo      || null,
      phone:            dto.phone           || null,
      problem_desc:     dto.problemDesc     || null,
      meter_reading_start: dto.meterReadingStart ? +dto.meterReadingStart : null,
      meter_unit:       dto.meterUnit        ?? "h",
      parts:            dto.parts            ?? [],
      labor_cost:       dto.laborCost        ? +dto.laborCost  : 0,
      other_cost:       dto.otherCost        ? +dto.otherCost  : 0,
      notes:            dto.notes            || null,
      tags:             dto.tags             ?? [],
      created_by:       userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateWorkOrder(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", assignedTo:"assigned_to", priority:"priority",
      startedAt:"started_at", completedAt:"completed_at",
      solutionDesc:"solution_desc", rootCause:"root_cause",
      laborHours:"labor_hours", laborCost:"labor_cost", otherCost:"other_cost",
      meterReadingEnd:"meter_reading_end", parts:"parts",
      notes:"notes", tags:"tags", phone:"phone", dueDate:"due_date",
      completionNotes:"completion_notes",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    if (dto.status === "in_progress" && !dto.startedAt)
      updates.started_at = new Date().toISOString();
    if (dto.status === "done" && !dto.completedAt)
      updates.completed_at = new Date().toISOString();
    const { data, error } = await this.db.from("work_orders")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Checklists ────────────────────────────────────────────────────────
  async findAllChecklists(tenantId: string, machineId?: string) {
    let q = this.db.from("inspection_checklists")
      .select("*, machinery(name,model,plate), farms(name)")
      .eq("tenant_id", tenantId).order("inspected_at", { ascending: false });
    if (machineId) q = q.eq("machinery_id", machineId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertChecklist(dto: any) {
    const payload = {
      tenant_id:    dto.tenantId,
      machinery_id: dto.machineryId  || null,
      farm_id:      dto.farmId       || null,
      work_order_id:dto.workOrderId  || null,
      plan_id:      dto.planId       || null,
      title:        dto.title,
      inspected_at: dto.inspectedAt  || new Date().toISOString().split("T")[0],
      inspector:    dto.inspector,
      meter_reading:dto.meterReading ? +dto.meterReading : null,
      meter_unit:   dto.meterUnit    ?? "h",
      items:        dto.items        ?? [],
      notes:        dto.notes        || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("inspection_checklists")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("inspection_checklists")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Histórico por ativo ───────────────────────────────────────────────
  async getHistory(tenantId: string, machineId?: string, dateFrom?: string) {
    let q = this.db.from("maintenance_history_view")
      .select("*").eq("tenant_id", tenantId)
      .order("opened_at", { ascending: false }).limit(200);
    if (machineId) q = q.eq("machinery_id", machineId);
    if (dateFrom)  q = q.gte("opened_at",   dateFrom);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getMachinery(tenantId: string) {
    const { data, error } = await this.db.from("machinery")
      .select("id, name, model, plate, type, status, hour_meter")
      .eq("tenant_id", tenantId).eq("active", true).order("name");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
