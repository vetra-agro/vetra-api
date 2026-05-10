import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class SalesService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Produtos ──────────────────────────────────────────────────────────
  async findAllProducts(tenantId: string, type?: string) {
    let q = this.db.from("products").select("*")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq("active", true).order("name");
    if (type) q = q.eq("type", type);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertProduct(dto: any) {
    const payload = {
      tenant_id:  dto.tenantId,
      code:       dto.code       || null,
      name:       dto.name,
      type:       dto.type       ?? "grain",
      description:dto.description|| null,
      unit:       dto.unit       ?? "sc",
      ncm:        dto.ncm        || null,
      crop:       dto.crop       || null,
      active:     dto.active     ?? true,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("products")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("products")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Tabela de Preços ──────────────────────────────────────────────────
  async findAllPriceLists(tenantId: string, productId?: string, activeOnly = true) {
    let q = this.db.from("price_lists")
      .select("*, products(name, type, unit, crop), seasons(name, crop)")
      .eq("tenant_id", tenantId).order("valid_from", { ascending: false });
    if (activeOnly) q = q.eq("active", true);
    if (productId)  q = q.eq("product_id", productId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertPriceList(dto: any) {
    const payload = {
      tenant_id:    dto.tenantId,
      product_id:   dto.productId,
      season_id:    dto.seasonId    || null,
      name:         dto.name,
      price_type:   dto.priceType   ?? "fixed",
      valid_from:   dto.validFrom,
      valid_until:  dto.validUntil  || null,
      unit_price:   dto.unitPrice   ? +dto.unitPrice   : null,
      currency:     dto.currency    ?? "BRL",
      index_base:   dto.indexBase   || null,
      basis:        dto.basis       ? +dto.basis       : null,
      basis_unit:   dto.basisUnit   || null,
      min_qty:      dto.minQty      ? +dto.minQty      : null,
      payment_terms:dto.paymentTerms|| null,
      notes:        dto.notes       || null,
      active:       dto.active      ?? true,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("price_lists")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("price_lists")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Pedidos de Venda / Orçamentos ─────────────────────────────────────
  async findAllOrders(tenantId: string, filters: {
    status?: string; isQuote?: boolean; farmId?: string;
    seasonId?: string; partnerId?: string;
    dateFrom?: string; dateTo?: string;
    page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db.from("sales_orders_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("order_date", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (filters.status)    q = q.eq("status",      filters.status);
    if (filters.isQuote !== undefined) q = q.eq("is_quote", filters.isQuote);
    if (filters.farmId)    q = q.eq("farm_id",     filters.farmId);
    if (filters.seasonId)  q = q.eq("season_id",   filters.seasonId);
    if (filters.partnerId) q = q.eq("partner_id",  filters.partnerId);
    if (filters.dateFrom)  q = q.gte("order_date", filters.dateFrom);
    if (filters.dateTo)    q = q.lte("order_date", filters.dateTo);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return {
      data: data ?? [],
      meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async findOne(id: string, tenantId: string) {
    const { data, error } = await this.db.from("sales_orders_summary")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !data) throw new NotFoundException("Pedido não encontrado");
    return data;
  }

  async createOrder(dto: any, userId?: string) {
    const subtotal = (dto.items ?? []).reduce((s: number, i: any) =>
      s + (+i.qty || 0) * (+i.unit_price || 0), 0);
    const total = subtotal - (+dto.discount || 0) + (+dto.taxes || 0);

    const { data, error } = await this.db.from("sales_orders").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId        || null,
      season_id:       dto.seasonId      || null,
      cost_center_id:  dto.costCenterId  || null,
      partner_id:      dto.partnerId,
      order_number:    dto.orderNumber   || null,
      status:          "draft",
      order_type:      dto.orderType     ?? "spot",
      is_quote:        dto.isQuote       ?? false,
      order_date:      dto.orderDate     ?? new Date().toISOString().split("T")[0],
      delivery_date:   dto.deliveryDate  || null,
      expiry_date:     dto.expiryDate    || null,
      items:           dto.items         ?? [],
      subtotal,
      discount:        +dto.discount     || 0,
      taxes:           +dto.taxes        || 0,
      total_amount:    dto.totalAmount   ?? total,
      currency:        dto.currency      ?? "BRL",
      is_forward:      dto.isForward     ?? false,
      forward_price:   dto.forwardPrice  || null,
      forward_expiry:  dto.forwardExpiry || null,
      salesperson:     dto.salesperson   || null,
      commission_pct:  +dto.commissionPct|| 0,
      delivery_address:dto.deliveryAddress|| null,
      payment_terms:   dto.paymentTerms  || null,
      notes:           dto.notes         || null,
      tags:            dto.tags          ?? [],
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateOrder(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", items:"items", subtotal:"subtotal",
      discount:"discount", taxes:"taxes", totalAmount:"total_amount",
      deliveryDate:"delivery_date", deliveryAddress:"delivery_address",
      paymentTerms:"payment_terms", salesperson:"salesperson",
      commissionPct:"commission_pct", notes:"notes",
      nfNumber:"nf_number", invoicedAt:"invoiced_at",
      approvedBy:"approved_by", rejectionReason:"rejection_reason",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    if (dto.status === "approved") updates.approved_at = new Date().toISOString();
    if (dto.status === "invoiced") updates.invoiced_at = new Date().toISOString();
    const { data, error } = await this.db.from("sales_orders")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async submitForApproval(id: string) {
    const { data, error } = await this.db.from("sales_orders")
      .update({ status: "pending_approval" }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Converte orçamento em pedido
  async convertQuoteToOrder(id: string) {
    const { data: quote } = await this.db.from("sales_orders")
      .select("*").eq("id", id).single();
    if (!quote) throw new NotFoundException("Orçamento não encontrado");
    if (!quote.is_quote) throw new BadRequestException("Não é um orçamento");
    const { data, error } = await this.db.from("sales_orders")
      .update({ is_quote: false, status: "draft" }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Aprovações ────────────────────────────────────────────────────────
  async getPendingApprovals(tenantId: string) {
    const { data, error } = await this.db.from("sales_orders_summary")
      .select("*").eq("tenant_id", tenantId)
      .eq("status", "pending_approval").order("order_date");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async approve(orderId: string, dto: {
    action: "approved" | "rejected" | "returned";
    approver: string; comments?: string; level?: number;
  }, tenantId: string) {
    await this.db.from("sales_approvals").insert({
      tenant_id: tenantId, order_id: orderId,
      action:    dto.action, approver: dto.approver,
      level:     dto.level ?? 1, comments: dto.comments,
    });
    const newStatus = dto.action === "approved" ? "approved"
      : dto.action === "rejected" ? "rejected" : "draft";
    const update: Record<string, any> = { status: newStatus };
    if (dto.action === "approved") { update.approved_by = dto.approver; update.approved_at = new Date().toISOString(); }
    if (dto.action === "rejected") { update.rejection_reason = dto.comments; }
    const { data, error } = await this.db.from("sales_orders")
      .update(update).eq("id", orderId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Comissões ─────────────────────────────────────────────────────────
  async findAllCommissions(tenantId: string, filters: {
    status?: string; salesperson?: string; dateFrom?: string; dateTo?: string;
  }) {
    let q = this.db.from("sales_commissions")
      .select("*, sales_orders(order_number, order_date, partner_id, partners(name))")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (filters.status)     q = q.eq("status",      filters.status);
    if (filters.salesperson)q = q.eq("salesperson",  filters.salesperson);
    if (filters.dateFrom)   q = q.gte("created_at",  filters.dateFrom);
    if (filters.dateTo)     q = q.lte("created_at",  filters.dateTo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async payCommission(id: string, dto: { paidAt: string; paymentRef?: string; notes?: string }) {
    const { data, error } = await this.db.from("sales_commissions")
      .update({ status: "paid", paid_at: dto.paidAt, payment_ref: dto.paymentRef, notes: dto.notes })
      .eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getCommissionSummary(tenantId: string) {
    const { data, error } = await this.db.from("commission_summary")
      .select("*").eq("tenant_id", tenantId).order("total_commission", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Clientes (parceiros do tipo buyer) ────────────────────────────────
  async getBuyers(tenantId: string) {
    const { data, error } = await this.db.from("partners")
      .select("id, name, document, email, phone, types, status")
      .eq("tenant_id", tenantId).eq("status", "active")
      .contains("types", ["buyer"]).order("name");
    if (error) {
      // fallback sem filtro de tipo
      const { data: all } = await this.db.from("partners")
        .select("id, name, document, email, phone, types, status")
        .eq("tenant_id", tenantId).eq("status", "active").order("name");
      return all ?? [];
    }
    return data ?? [];
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const month = new Date().toISOString().slice(0, 7);
    const [ordersRes, commRes] = await Promise.all([
      this.db.from("sales_orders")
        .select("status, total_amount, order_date, is_quote")
        .eq("tenant_id", tenantId),
      this.db.from("sales_commissions")
        .select("status, commission_amt")
        .eq("tenant_id", tenantId),
    ]);
    const orders = ordersRes.data ?? [];
    const comms  = commRes.data  ?? [];
    const active = orders.filter((o: any) => !["cancelled","draft"].includes(o.status) && !o.is_quote);
    return {
      quotes_open:          orders.filter((o: any) => o.is_quote && o.status === "draft").length,
      orders_pending:       orders.filter((o: any) => o.status === "pending_approval").length,
      orders_approved:      orders.filter((o: any) => o.status === "approved").length,
      revenue_month:        orders.filter((o: any) => o.order_date?.startsWith(month) && !o.is_quote)
                                  .reduce((s: number, o: any) => s + (+o.total_amount || 0), 0),
      revenue_total:        active.reduce((s: number, o: any) => s + (+o.total_amount || 0), 0),
      commission_pending:   comms.filter((c: any) => c.status === "pending")
                                 .reduce((s: number, c: any) => s + (+c.commission_amt || 0), 0),
    };
  }
}
