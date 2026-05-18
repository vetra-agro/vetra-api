import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class LogisticsService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Transportadoras ───────────────────────────────────────────────────
  async findAllCarriers(tenantId: string, active?: boolean) {
    let q = this.db.from("carriers").select("*, partners(name,document)")
      .eq("tenant_id", tenantId).order("name");
    if (active !== undefined) q = q.eq("active", active);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertCarrier(dto: any) {
    const payload = {
      tenant_id:    dto.tenantId,
      partner_id:   dto.partnerId   || null,
      name:         dto.name,
      document:     dto.document    || null,
      carrier_type: dto.carrierType ?? "third_party",
      antt_code:    dto.anttCode    || null,
      contact_name: dto.contactName || null,
      phone:        dto.phone       || null,
      email:        dto.email       || null,
      address:      dto.address     || null,
      modes:        dto.modes       ?? ["road"],
      payment_terms:dto.paymentTerms|| null,
      notes:        dto.notes       || null,
      tags:         dto.tags        ?? [],
      active:       dto.active      ?? true,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("carriers")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("carriers")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findAllDrivers(tenantId: string, carrierId?: string) {
    let q = this.db.from("drivers").select("*, carriers(name)")
      .eq("tenant_id", tenantId).eq("active", true).order("name");
    if (carrierId) q = q.eq("carrier_id", carrierId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertDriver(dto: any) {
    const payload = {
      tenant_id:    dto.tenantId,
      carrier_id:   dto.carrierId  || null,
      name:         dto.name,
      cpf:          dto.cpf        || null,
      cnh:          dto.cnh        || null,
      cnh_category: dto.cnhCategory|| null,
      cnh_expiry:   dto.cnhExpiry  || null,
      phone:        dto.phone      || null,
      is_own:       dto.isOwn      ?? false,
      active:       dto.active     ?? true,
      notes:        dto.notes      || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("drivers")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("drivers")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findAllVehicles(tenantId: string, carrierId?: string) {
    let q = this.db.from("vehicles").select("*, carriers(name)")
      .eq("tenant_id", tenantId).eq("active", true).order("plate");
    if (carrierId) q = q.eq("carrier_id", carrierId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertVehicle(dto: any) {
    const payload = {
      tenant_id:      dto.tenantId,
      carrier_id:     dto.carrierId    || null,
      machinery_id:   dto.machineryId  || null,
      plate:          dto.plate        || null,
      plate_trailer:  dto.plateTrailer || null,
      vehicle_type:   dto.vehicleType  ?? "truck",
      brand:          dto.brand        || null,
      model:          dto.model        || null,
      year:           dto.year         || null,
      tara_kg:        dto.taraKg       ? +dto.taraKg       : null,
      capacity_kg:    dto.capacityKg   ? +dto.capacityKg   : null,
      capacity_sc:    dto.capacitySc   ? +dto.capacitySc   : null,
      antt_code:      dto.anttCode     || null,
      is_own:         dto.isOwn        ?? false,
      active:         dto.active       ?? true,
      notes:          dto.notes        || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("vehicles")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("vehicles")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Ordens de Frete ───────────────────────────────────────────────────
  async findAllFreightOrders(tenantId: string, filters: {
    status?: string; cargoType?: string; farmId?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db.from("freight_orders_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("scheduled_date", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (filters.status)    q = q.eq("status",       filters.status);
    if (filters.cargoType) q = q.eq("cargo_type",   filters.cargoType);
    if (filters.farmId)    q = q.eq("farm_id",      filters.farmId);
    if (filters.dateFrom)  q = q.gte("scheduled_date", filters.dateFrom);
    if (filters.dateTo)    q = q.lte("scheduled_date", filters.dateTo);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async findFreightOrderById(id: string, tenantId: string) {
    const { data, error } = await this.db.from("freight_orders_summary")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !data) throw new NotFoundException("Ordem de frete não encontrada");
    const { data: legs } = await this.db.from("freight_legs")
      .select("*, carriers(name), drivers(name,cnh), vehicles(plate,plate_trailer,vehicle_type)")
      .eq("freight_order_id", id).order("sequence");
    return { ...data, legs: legs ?? [] };
  }

  async createFreightOrder(dto: any, userId?: string) {
    const { data, error } = await this.db.from("freight_orders").insert({
      tenant_id:         dto.tenantId,
      farm_id:           dto.farmId           || null,
      season_id:         dto.seasonId         || null,
      purchase_order_id: dto.purchaseOrderId  || null,
      sale_contract_id:  dto.saleContractId   || null,
      sale_order_id:     dto.saleOrderId      || null,
      order_number:      dto.orderNumber      || null,
      cargo_type:        dto.cargoType        ?? "output",
      product_name:      dto.productName,
      unit:              dto.unit             ?? "sc",
      qty_planned:       +dto.qtyPlanned,
      origin_name:       dto.originName,
      origin_address:    dto.originAddress    || null,
      origin_lat:        dto.originLat        || null,
      origin_lng:        dto.originLng        || null,
      dest_name:         dto.destName,
      dest_address:      dto.destAddress      || null,
      dest_lat:          dto.destLat          || null,
      dest_lng:          dto.destLng          || null,
      scheduled_date:    dto.scheduledDate,
      freight_value:     dto.freightValue     ? +dto.freightValue  : null,
      freight_unit:      dto.freightUnit      || null,
      notes:             dto.notes            || null,
      tags:              dto.tags             ?? [],
      created_by:        userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateFreightOrder(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", qtyLoaded:"qty_loaded", qtyDelivered:"qty_delivered",
      grossWeightKg:"gross_weight_kg", netWeightKg:"net_weight_kg",
      loadedAt:"loaded_at", deliveredAt:"delivered_at", eta:"eta",
      freightValue:"freight_value", cteNumber:"cte_number",
      cteKey:"cte_key", cteValue:"cte_value", cteIssuedAt:"cte_issued_at",
      notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("freight_orders")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Pernas do frete ───────────────────────────────────────────────────
  async addLeg(dto: any) {
    const { data, error } = await this.db.from("freight_legs").insert({
      freight_order_id: dto.freightOrderId,
      tenant_id:        dto.tenantId,
      carrier_id:       dto.carrierId    || null,
      driver_id:        dto.driverId     || null,
      vehicle_id:       dto.vehicleId    || null,
      sequence:         dto.sequence     ?? 1,
      mode:             dto.mode         ?? "road",
      origin_name:      dto.originName,
      origin_address:   dto.originAddress|| null,
      dest_name:        dto.destName,
      dest_address:     dto.destAddress  || null,
      scheduled_date:   dto.scheduledDate|| null,
      qty:              dto.qty          ? +dto.qty          : null,
      gross_weight_kg:  dto.grossWeightKg? +dto.grossWeightKg: null,
      net_weight_kg:    dto.netWeightKg  ? +dto.netWeightKg  : null,
      freight_value:    dto.freightValue ? +dto.freightValue  : null,
      cte_number:       dto.cteNumber    || null,
      ticket_number:    dto.ticketNumber || null,
      seal_number:      dto.sealNumber   || null,
      notes:            dto.notes        || null,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateLeg(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", carrierId:"carrier_id", driverId:"driver_id",
      vehicleId:"vehicle_id", departedAt:"departed_at", arrivedAt:"arrived_at",
      eta:"eta", qty:"qty", grossWeightKg:"gross_weight_kg",
      netWeightKg:"net_weight_kg", freightValue:"freight_value",
      cteNumber:"cte_number", cteKey:"cte_key", ticketNumber:"ticket_number",
      sealNumber:"seal_number", notes:"notes",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("freight_legs")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Tracking ──────────────────────────────────────────────────────────
  async addTracking(dto: any) {
    const { data, error } = await this.db.from("freight_tracking").insert({
      freight_leg_id: dto.freightLegId,
      tenant_id:      dto.tenantId,
      tracked_at:     dto.trackedAt     || new Date().toISOString(),
      lat:            dto.lat           || null,
      lng:            dto.lng           || null,
      speed_kmh:      dto.speedKmh      || null,
      event_type:     dto.eventType     || null,
      event_desc:     dto.eventDesc     || null,
      source:         dto.source        ?? "manual",
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTracking(legId: string) {
    const { data, error } = await this.db.from("freight_tracking")
      .select("*").eq("freight_leg_id", legId)
      .order("tracked_at", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Romaneios ─────────────────────────────────────────────────────────
  async findAllManifests(tenantId: string, farmId?: string, dateFrom?: string) {
    let q = this.db.from("manifests")
      .select("*, farms(name), freight_orders(order_number)")
      .eq("tenant_id", tenantId).order("issued_at", { ascending: false });
    if (farmId)   q = q.eq("farm_id",    farmId);
    if (dateFrom) q = q.gte("issued_at", dateFrom);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertManifest(dto: any, userId?: string) {
    const payload = {
      tenant_id:        dto.tenantId,
      farm_id:          dto.farmId          || null,
      freight_order_id: dto.freightOrderId  || null,
      manifest_number:  dto.manifestNumber  || null,
      issued_at:        dto.issuedAt        || new Date().toISOString().split("T")[0],
      product_name:     dto.productName,
      unit:             dto.unit            ?? "sc",
      items:            dto.items           ?? [],
      origin_name:      dto.originName      || null,
      dest_name:        dto.destName        || null,
      notes:            dto.notes           || null,
      created_by:       userId,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("manifests")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("manifests")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Custo logístico por contrato ──────────────────────────────────────
  async getCostByContract(tenantId: string, seasonId?: string) {
    let q = this.db.from("logistics_cost_by_contract")
      .select("*").eq("tenant_id", tenantId)
      .order("total_freight_cost", { ascending: false });
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const today = new Date().toISOString().split("T")[0];
    const [foRes, legRes] = await Promise.all([
      this.db.from("freight_orders").select("status, qty_planned, qty_delivered, freight_value, scheduled_date")
        .eq("tenant_id", tenantId),
      this.db.from("freight_legs").select("status, arrived_at, eta")
        .eq("tenant_id", tenantId),
    ]);
    const orders = foRes.data  ?? [];
    const legs   = legRes.data ?? [];
    return {
      in_transit:       orders.filter((o: any) => o.status === "in_transit").length,
      scheduled_today:  orders.filter((o: any) => o.scheduled_date === today).length,
      late:             legs.filter((l: any) => l.status !== "delivered" && l.eta && l.eta < new Date().toISOString()).length,
      delivered_month:  orders.filter((o: any) => o.status === "delivered").length,
      total_cost:       orders.reduce((s: number, o: any) => s + (+o.freight_value || 0), 0),
      qty_in_transit:   orders.filter((o: any) => ["loading","in_transit","unloading"].includes(o.status))
                              .reduce((s: number, o: any) => s + (+o.qty_planned || 0), 0),
    };
  }
}
