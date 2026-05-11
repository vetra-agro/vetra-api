import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class AgroSalesService {
  constructor(private supabase: SupabaseProvider) { }
  private get db() { return this.supabase.getAdminClient(); }

  // ── Contratos de Venda Agrícola ───────────────────────────────────────
  async findAllContracts(tenantId: string, filters: {
    status?: string; seasonId?: string; crop?: string; partnerId?: string;
  }) {
    let q = this.db.from("agro_sale_contracts")
      .select(`*, partners(name,document,phone), farms(name),
               seasons(name,crop), agro_sale_deliveries(id,delivery_date,qty_delivered)`)
      .eq("tenant_id", tenantId)
      .order("delivery_end");
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.seasonId) q = q.eq("season_id", filters.seasonId);
    if (filters.crop) q = q.eq("crop", filters.crop);
    if (filters.partnerId) q = q.eq("partner_id", filters.partnerId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createContract(dto: any, userId?: string) {
    const { data, error } = await this.db.from("agro_sale_contracts").insert({
      tenant_id: dto.tenantId,
      farm_id: dto.farmId || null,
      season_id: dto.seasonId || null,
      partner_id: dto.partnerId,
      contract_number: dto.contractNumber || null,
      contract_type: dto.contractType ?? "forward",
      crop: dto.crop,
      product_id: dto.productId || null,
      unit: dto.unit ?? "sc",
      qty_contracted: +dto.qtyContracted,
      price_type: dto.priceType ?? "fixed",
      unit_price: dto.unitPrice ? +dto.unitPrice : null,
      currency: dto.currency ?? "BRL",
      index_base: dto.indexBase || null,
      basis: dto.basis ? +dto.basis : null,
      basis_unit: dto.basisUnit || null,
      signed_at: dto.signedAt || null,
      delivery_start: dto.deliveryStart || null,
      delivery_end: dto.deliveryEnd,
      cpr_number: dto.cprNumber || null,
      cpr_registry: dto.cprRegistry || null,
      cpr_value: dto.cprValue ? +dto.cprValue : null,
      payment_terms: dto.paymentTerms || null,
      delivery_address: dto.deliveryAddress || null,
      quality_spec: dto.qualitySpec || null,
      penalty_clause: dto.penaltyClause || null,
      notes: dto.notes || null,
      tags: dto.tags ?? [],
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateContract(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status: "status", qtyContracted: "qty_contracted", unitPrice: "unit_price",
      deliveryEnd: "delivery_end", deliveryStart: "delivery_start",
      paymentTerms: "payment_terms", qualitySpec: "quality_spec",
      notes: "notes", tags: "tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("agro_sale_contracts")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async registerDelivery(dto: {
    contractId: string; tenantId: string; deliveryDate: string;
    qtyDelivered: number; unitPrice?: number; nfNumber?: string;
    ticketNumber?: string; moisturePct?: number; impurityPct?: number; notes?: string;
  }) {
    const contract = await this.db.from("agro_sale_contracts")
      .select("qty_pending, unit_price, unit").eq("id", dto.contractId).single();
    if (!contract.data) throw new NotFoundException("Contrato não encontrado");
    if (+dto.qtyDelivered > +(contract.data.qty_pending ?? 0) + 0.001)
      throw new BadRequestException(`Quantidade entregue (${dto.qtyDelivered}) supera o saldo pendente (${contract.data.qty_pending})`);

    const unitPrice = dto.unitPrice ?? contract.data.unit_price ?? 0;
    const totalValue = Math.round(+dto.qtyDelivered * +unitPrice * 100) / 100;

    const { data, error } = await this.db.from("agro_sale_deliveries").insert({
      contract_id: dto.contractId,
      tenant_id: dto.tenantId,
      delivery_date: dto.deliveryDate,
      qty_delivered: dto.qtyDelivered,
      unit: contract.data.unit,
      unit_price: unitPrice,
      total_value: totalValue,
      nf_number: dto.nfNumber || null,
      ticket_number: dto.ticketNumber || null,
      moisture_pct: dto.moisturePct ?? null,
      impurity_pct: dto.impurityPct ?? null,
      notes: dto.notes || null,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Fixação de Preço ──────────────────────────────────────────────────
  async findAllPricings(tenantId: string, status?: string, seasonId?: string) {
    let q = this.db.from("commodity_pricings")
      .select("*, seasons(name,crop), agro_sale_contracts(contract_number,crop), pricing_orders(*)")
      .eq("tenant_id", tenantId).order("fix_deadline");
    if (status) q = q.eq("status", status);
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createPricing(dto: any, userId?: string) {
    const { data, error } = await this.db.from("commodity_pricings").insert({
      tenant_id: dto.tenantId,
      contract_id: dto.contractId || null,
      season_id: dto.seasonId || null,
      crop: dto.crop,
      total_qty: +dto.totalQty,
      unit: dto.unit ?? "sc",
      index_base: dto.indexBase,
      basis: dto.basis ? +dto.basis : null,
      basis_unit: dto.basisUnit ?? "R$/sc",
      currency: dto.currency ?? "USD",
      fix_deadline: dto.fixDeadline || null,
      season_ref: dto.seasonRef || null,
      notes: dto.notes || null,
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addPricingOrder(pricingId: string, dto: any, tenantId: string) {
    const { data: pricing } = await this.db.from("commodity_pricings")
      .select("qty_open").eq("id", pricingId).single();
    if (!pricing) throw new NotFoundException("Posição não encontrada");
    if (+dto.qty > +(pricing.qty_open ?? 0) + 0.001)
      throw new BadRequestException(`Quantidade (${dto.qty}) supera o volume em aberto (${pricing.qty_open})`);

    const { data, error } = await this.db.from("pricing_orders").insert({
      pricing_id: pricingId,
      tenant_id: tenantId,
      fixed_at: dto.fixedAt,
      qty: +dto.qty,
      price: +dto.price,
      price_brl: dto.priceBrl ? +dto.priceBrl : null,
      exchange_rate: dto.exchangeRate ? +dto.exchangeRate : null,
      broker: dto.broker || null,
      order_ref: dto.orderRef || null,
      notes: dto.notes || null,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Volumes ───────────────────────────────────────────────────────────
  async getVolumesSummary(tenantId: string, seasonId?: string) {
    let q = this.db.from("agro_volumes_summary")
      .select("*").eq("tenant_id", tenantId)
      .order("total_contracted", { ascending: false });
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getContractTimeline(tenantId: string, seasonId?: string) {
    let q = this.db.from("agro_sale_contracts")
      .select(`id, contract_number, crop, partner_id, partners(name),
               qty_contracted, qty_delivered, qty_pending,
               delivery_start, delivery_end, status, contract_type,
               unit_price, currency, unit`)
      .eq("tenant_id", tenantId)
      .not("status", "eq", "cancelled")
      .order("delivery_end");
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const today = new Date().toISOString().split("T")[0];
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    const [cRes, pRes] = await Promise.all([
      this.db.from("agro_sale_contracts")
        .select("status, qty_contracted, qty_delivered, qty_pending, total_amount, delivery_end")
        .eq("tenant_id", tenantId),
      this.db.from("commodity_pricings")
        .select("status, qty_open, total_qty")
        .eq("tenant_id", tenantId),
    ]);
    const contracts = cRes.data ?? [];
    const pricings = pRes.data ?? [];
    const active = contracts.filter((c: any) => ["active", "partial"].includes(c.status));
    return {
      contracts_active: active.length,
      total_contracted: active.reduce((s: number, c: any) => s + (+c.qty_contracted || 0), 0),
      total_delivered: active.reduce((s: number, c: any) => s + (+c.qty_delivered || 0), 0),
      total_pending: active.reduce((s: number, c: any) => s + (+c.qty_pending || 0), 0),
      total_value: active.reduce((s: number, c: any) => s + (+c.total_amount || 0), 0),
      expiring_30d: active.filter((c: any) => c.delivery_end <= in30).length,
      pricings_open: pricings.filter((p: any) => ["open", "partial"].includes(p.status)).length,
      qty_to_fix: pricings.filter((p: any) => ["open", "partial"].includes(p.status))
        .reduce((s: number, p: any) => s + (+p.qty_open || 0), 0),
    };
  }
}
