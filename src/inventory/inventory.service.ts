import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class InventoryService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Catálogo de itens ──────────────────────────────────────────────────
  async findAllItems(tenantId: string, filters: { category?: string; search?: string; active?: boolean }) {
    let q = this.db.from("stock_items")
      .select("*, partners(name)")
      .eq("tenant_id", tenantId).order("name");
    if (filters.active !== false) q = q.eq("active", true);
    if (filters.category) q = q.eq("category", filters.category);
    if (filters.search)   q = q.ilike("name", `%${filters.search}%`);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertItem(dto: any) {
    const payload = {
      tenant_id:         dto.tenantId,
      product_id:        dto.productId       || null,
      supplier_id:       dto.supplierId      || null,
      code:              dto.code            || null,
      name:              dto.name,
      description:       dto.description     || null,
      category:          dto.category        ?? "input",
      unit:              dto.unit            ?? "un",
      unit_secondary:    dto.unitSecondary   || null,
      conversion_factor: dto.conversionFactor ? +dto.conversionFactor : 1,
      active_ingredient: dto.activeIngredient|| null,
      formulation:       dto.formulation     || null,
      toxicity_class:    dto.toxicityClass   ? +dto.toxicityClass   : null,
      anvisa_reg:        dto.anvisaReg       || null,
      mapa_reg:          dto.mapaReg         || null,
      pre_harvest_days:  dto.preHarvestDays  ? +dto.preHarvestDays  : null,
      manages_lot:       dto.managesLot      ?? false,
      manages_expiry:    dto.managesExpiry   ?? false,
      active:            dto.active          ?? true,
      notes:             dto.notes           || null,
      tags:              dto.tags            ?? [],
    };
    if (dto.id) {
      const { data, error } = await this.db.from("stock_items").update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("stock_items").insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Localizações ───────────────────────────────────────────────────────
  async findAllLocations(tenantId: string, farmId?: string) {
    let q = this.db.from("stock_locations")
      .select("*, farms(name), partners(name)").eq("tenant_id", tenantId).eq("active", true).order("name");
    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertLocation(dto: any) {
    const payload = {
      tenant_id:     dto.tenantId,
      farm_id:       dto.farmId      || null,
      partner_id:    dto.partnerId   || null,
      code:          dto.code        || null,
      name:          dto.name,
      location_type: dto.locationType ?? "warehouse",
      capacity:      dto.capacity     ? +dto.capacity : null,
      capacity_unit: dto.capacityUnit ?? "sc",
      address:       dto.address      || null,
      lat:           dto.lat          ? +dto.lat : null,
      lng:           dto.lng          ? +dto.lng : null,
      external_code: dto.externalCode || null,
      active:        dto.active       ?? true,
      notes:         dto.notes        || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("stock_locations").update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("stock_locations").insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Saldos ─────────────────────────────────────────────────────────────
  async getBalances(tenantId: string, filters: { locationId?: string; category?: string; belowMin?: boolean; search?: string }) {
    let q = this.db.from("stock_balances_summary")
      .select("*").eq("tenant_id", tenantId).order("item_name");
    if (filters.locationId) q = q.eq("location_id",    filters.locationId);
    if (filters.category)   q = q.eq("item_category",  filters.category);
    if (filters.belowMin)   q = q.eq("below_min",      true);
    if (filters.search)     q = q.ilike("item_name",   `%${filters.search}%`);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async updateMinMax(itemId: string, locationId: string | null, dto: {
    qtyMin: number; qtyReorder: number; qtyMax?: number;
  }) {
    const { data, error } = await this.db.from("stock_balances")
      .update({ qty_min: dto.qtyMin, qty_reorder: dto.qtyReorder, qty_max: dto.qtyMax ?? null })
      .eq("item_id", itemId)
      .match(locationId ? { location_id: locationId } : {})
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Movimentações ──────────────────────────────────────────────────────
  async findAllMoves(tenantId: string, filters: {
    moveType?: string; status?: string; itemId?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db.from("stock_moves_detail")
      .select("*", { count:"exact" }).eq("tenant_id", tenantId)
      .order("move_date", { ascending: false })
      .range((page-1)*limit, page*limit-1);
    if (filters.moveType) q = q.eq("move_type", filters.moveType);
    if (filters.status)   q = q.eq("status",    filters.status);
    if (filters.itemId)   q = q.eq("item_id",   filters.itemId);
    if (filters.dateFrom) q = q.gte("move_date", filters.dateFrom);
    if (filters.dateTo)   q = q.lte("move_date", filters.dateTo);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count??0, page, limit, pages: Math.ceil((count??0)/limit) } };
  }

  async createMove(dto: any, userId?: string) {
    // Valida saldo se for saída
    if (["exit","transfer"].includes(dto.moveType)) {
      const { data: bal } = await this.db.from("stock_balances")
        .select("qty_on_hand").eq("item_id", dto.itemId)
        .match(dto.locationId ? { location_id: dto.locationId } : {}).maybeSingle();
      if ((bal?.qty_on_hand ?? 0) < +dto.qty)
        throw new BadRequestException(
          `Saldo insuficiente. Disponível: ${bal?.qty_on_hand ?? 0} — Solicitado: ${dto.qty}`
        );
    }

    const { data, error } = await this.db.from("stock_moves").insert({
      tenant_id:         dto.tenantId,
      item_id:           dto.itemId,
      location_id:       dto.locationId       || null,
      location_dest_id:  dto.locationDestId   || null,
      lot_id:            dto.lotId            || null,
      farm_id:           dto.farmId           || null,
      season_id:         dto.seasonId         || null,
      cost_center_id:    dto.costCenterId     || null,
      purchase_order_id: dto.purchaseOrderId  || null,
      sale_contract_id:  dto.saleContractId   || null,
      move_type:         dto.moveType,
      status:            dto.status           ?? "draft",
      move_date:         dto.moveDate         || new Date().toISOString().split("T")[0],
      document_ref:      dto.documentRef      || null,
      qty:               +dto.qty,
      unit:              dto.unit,
      unit_cost:         dto.unitCost         ? +dto.unitCost : 0,
      reason:            dto.reason           || null,
      notes:             dto.notes            || null,
      created_by:        userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async confirmMove(id: string) {
    const { data, error } = await this.db.from("stock_moves")
      .update({ status: "confirmed" }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async cancelMove(id: string, dto: { reason: string; cancelledBy: string }) {
    const { data: move } = await this.db.from("stock_moves").select("status").eq("id", id).single();
    if (!move) throw new NotFoundException("Movimentação não encontrada");
    if (move.status === "cancelled") throw new BadRequestException("Já cancelada");
    const { data, error } = await this.db.from("stock_moves").update({
      status:       "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: dto.cancelledBy,
      cancel_reason: dto.reason,
    }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Ajuste de inventário ───────────────────────────────────────────────
  async adjustInventory(dto: {
    tenantId: string; itemId: string; locationId?: string;
    qtyActual: number; unit: string; reason: string; notes?: string;
  }, userId?: string) {
    const { data: bal } = await this.db.from("stock_balances")
      .select("qty_on_hand").eq("item_id", dto.itemId)
      .match(dto.locationId ? { location_id: dto.locationId } : {}).maybeSingle();
    const qtyBefore = bal?.qty_on_hand ?? 0;
    const diff      = dto.qtyActual - qtyBefore;
    if (diff === 0) throw new BadRequestException("Sem diferença — nenhum ajuste necessário");

    const move = await this.createMove({
      tenantId:   dto.tenantId,
      itemId:     dto.itemId,
      locationId: dto.locationId,
      moveType:   "adjustment",
      status:     "draft",
      qty:        Math.abs(diff),
      unit:       dto.unit,
      reason:     dto.reason,
      notes:      dto.notes,
      qtyBefore,
      qtyAfter:   dto.qtyActual,
    }, userId);

    // Auto-confirma ajuste
    const confirmed = await this.confirmMove(move.id);
    return { move: confirmed, qtyBefore, qtyAfter: dto.qtyActual, diff };
  }

  // ── Lotes ──────────────────────────────────────────────────────────────
  async findAllLots(tenantId: string, itemId?: string, status?: string) {
    let q = this.db.from("stock_lots")
      .select("*, stock_items(name,code,unit), stock_locations(name), partners(name)")
      .eq("tenant_id", tenantId).order("entry_date", { ascending: false });
    if (itemId) q = q.eq("item_id", itemId);
    if (status) q = q.eq("status",  status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertLot(dto: any) {
    const payload = {
      tenant_id:        dto.tenantId,
      item_id:          dto.itemId,
      location_id:      dto.locationId      || null,
      supplier_id:      dto.supplierId      || null,
      lot_number:       dto.lotNumber,
      status:           dto.status          ?? "active",
      manufacture_date: dto.manufactureDate || null,
      expiry_date:      dto.expiryDate      || null,
      entry_date:       dto.entryDate       || new Date().toISOString().split("T")[0],
      qty_received:     +dto.qtyReceived,
      qty_on_hand:      dto.qtyOnHand       ? +dto.qtyOnHand : +dto.qtyReceived,
      unit:             dto.unit,
      unit_cost:        dto.unitCost        ? +dto.unitCost : null,
      nf_number:        dto.nfNumber        || null,
      document_ref:     dto.documentRef     || null,
      notes:            dto.notes           || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("stock_lots").update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("stock_lots").insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Qualidade ──────────────────────────────────────────────────────────
  async findAllQuality(tenantId: string, itemId?: string) {
    let q = this.db.from("stock_quality")
      .select("*, stock_items(name,code), stock_lots(lot_number), stock_locations(name)")
      .eq("tenant_id", tenantId).order("analysis_date", { ascending: false });
    if (itemId) q = q.eq("item_id", itemId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertQuality(dto: any) {
    const payload = {
      tenant_id:       dto.tenantId,
      item_id:         dto.itemId,
      lot_id:          dto.lotId         || null,
      location_id:     dto.locationId    || null,
      move_id:         dto.moveId        || null,
      analysis_date:   dto.analysisDate  || new Date().toISOString().split("T")[0],
      analyst:         dto.analyst       || null,
      result:          dto.result        ?? "approved",
      moisture_pct:    dto.moisturePct   ? +dto.moisturePct   : null,
      impurity_pct:    dto.impurityPct   ? +dto.impurityPct   : null,
      damaged_pct:     dto.damagedPct    ? +dto.damagedPct    : null,
      broken_pct:      dto.brokenPct     ? +dto.brokenPct     : null,
      greenish_pct:    dto.greenishPct   ? +dto.greenishPct   : null,
      weight_1000:     dto.weight1000    ? +dto.weight1000    : null,
      ph_value:        dto.phValue       ? +dto.phValue       : null,
      density:         dto.density       ? +dto.density       : null,
      discount_pct:    dto.discountPct   ? +dto.discountPct   : 0,
      classification:  dto.classification|| null,
      notes:           dto.notes         || null,
      custom_params:   dto.customParams  ?? {},
    };
    if (dto.id) {
      const { data, error } = await this.db.from("stock_quality").update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("stock_quality").insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const [balRes, movRes] = await Promise.all([
      this.db.from("stock_balances").select("qty_on_hand, qty_min, total_value").eq("tenant_id", tenantId),
      this.db.from("stock_moves").select("move_type, status, move_date").eq("tenant_id", tenantId)
        .gte("move_date", new Date(Date.now()-30*86400000).toISOString().split("T")[0]),
    ]);
    const bals = balRes.data ?? [];
    const movs = movRes.data ?? [];
    return {
      total_items:    bals.length,
      below_min:      bals.filter((b: any) => b.qty_min > 0 && b.qty_on_hand < b.qty_min).length,
      total_value:    bals.reduce((s: number, b: any) => s + (+b.total_value || 0), 0),
      moves_month:    movs.filter((m: any) => m.status === "confirmed").length,
      pending_moves:  movs.filter((m: any) => m.status === "draft").length,
    };
  }
}
