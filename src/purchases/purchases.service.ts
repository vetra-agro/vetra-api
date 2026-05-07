import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class PurchasesService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Requisições ───────────────────────────────────────────────────────
  async findAllRequests(tenantId: string, status?: string, farmId?: string) {
    let q = this.db.from("purchase_requests").select("*, farms(name), seasons(name,crop), cost_centers(name)")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createRequest(dto: any, userId?: string) {
    const estimated = (dto.items ?? []).reduce((s: number, i: any) =>
      s + (+i.qty || 0) * (+i.estimated_unit_price || 0), 0);
    const { data, error } = await this.db.from("purchase_requests").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId,
      season_id:       dto.seasonId,
      cost_center_id:  dto.costCenterId,
      title:           dto.title,
      description:     dto.description,
      urgency:         dto.urgency        ?? "normal",
      needed_by:       dto.neededBy,
      items:           dto.items          ?? [],
      estimated_total: dto.estimatedTotal ?? estimated,
      requested_by:    dto.requestedBy,
      notes:           dto.notes,
      tags:            dto.tags           ?? [],
      status:          "draft",
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateRequest(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      title:"title", description:"description", urgency:"urgency",
      neededBy:"needed_by", items:"items", estimatedTotal:"estimated_total",
      status:"status", approvedBy:"approved_by", rejectionReason:"rejection_reason",
      notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    if (dto.status === "approved") updates.approved_at = new Date().toISOString();
    const { data, error } = await this.db.from("purchase_requests")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Cotações ──────────────────────────────────────────────────────────
  async findAllQuotes(tenantId: string, status?: string) {
    let q = this.db.from("purchase_quotes")
      .select("*, purchase_quote_responses(id, partner_name, total_amount, is_winner)")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createQuote(dto: any, userId?: string) {
    const { data, error } = await this.db.from("purchase_quotes").insert({
      tenant_id:  dto.tenantId,
      request_id: dto.requestId,
      farm_id:    dto.farmId,
      title:      dto.title,
      deadline:   dto.deadline,
      items:      dto.items    ?? [],
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addQuoteResponse(dto: any) {
    const { data, error } = await this.db.from("purchase_quote_responses").insert({
      quote_id:      dto.quoteId,
      tenant_id:     dto.tenantId,
      partner_id:    dto.partnerId,
      partner_name:  dto.partnerName,
      responded_at:  dto.respondedAt  ?? new Date().toISOString(),
      valid_until:   dto.validUntil,
      payment_terms: dto.paymentTerms,
      delivery_days: dto.deliveryDays,
      items:         dto.items        ?? [],
      total_amount:  dto.totalAmount,
      notes:         dto.notes,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getQuoteComparison(quoteId: string) {
    // Busca a cotação e todas as respostas
    const { data: quote } = await this.db.from("purchase_quotes")
      .select("*").eq("id", quoteId).single();
    const { data: responses } = await this.db.from("purchase_quote_responses")
      .select("*, partners(name,document)").eq("quote_id", quoteId)
      .order("total_amount", { nullsFirst: false });
    if (!quote) throw new NotFoundException("Cotação não encontrada");

    // Mapa de comparação: por item × fornecedor
    const items = quote.items ?? [];
    const resps = responses ?? [];
    const comparison = items.map((item: any) => {
      const supplierPrices = resps.map((r: any) => {
        const ri = (r.items ?? []).find((i: any) =>
          i.product?.toLowerCase() === item.product?.toLowerCase()
        );
        return {
          response_id:  r.id,
          partner_name: r.partner_name ?? r.partners?.name,
          unit_price:   ri?.unit_price  ?? null,
          total:        ri?.total        ?? null,
          brand:        ri?.brand        ?? null,
          is_winner:    r.is_winner,
        };
      });
      const prices = supplierPrices.filter((s: any) => s.unit_price != null);
      const minPrice = prices.length > 0 ? Math.min(...prices.map((s: any) => +s.unit_price)) : null;
      return { ...item, suppliers: supplierPrices, min_price: minPrice };
    });

    return { quote, responses: resps, comparison };
  }

  async awardQuote(quoteId: string, responseId: string, tenantId: string) {
    // Marca o vencedor
    await this.db.from("purchase_quote_responses")
      .update({ is_winner: false }).eq("quote_id", quoteId);
    await this.db.from("purchase_quote_responses")
      .update({ is_winner: true }).eq("id", responseId);
    await this.db.from("purchase_quotes")
      .update({ status: "awarded" }).eq("id", quoteId);
    return { awarded: responseId };
  }

  // ── Pedidos de Compra ─────────────────────────────────────────────────
  async findAllOrders(tenantId: string, filters: {
    status?: string; farmId?: string; partnerId?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db.from("purchase_orders_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("order_date", { ascending: false })
      .range((page-1)*limit, page*limit-1);
    if (filters.status)    q = q.eq("status",     filters.status);
    if (filters.farmId)    q = q.eq("farm_id",    filters.farmId);
    if (filters.partnerId) q = q.eq("partner_id", filters.partnerId);
    if (filters.dateFrom)  q = q.gte("order_date", filters.dateFrom);
    if (filters.dateTo)    q = q.lte("order_date", filters.dateTo);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async createOrder(dto: any, userId?: string) {
    const subtotal = (dto.items ?? []).reduce((s: number, i: any) =>
      s + (+i.qty || 0) * (+i.unit_price || 0), 0);
    const total = subtotal - (+dto.discount || 0) + (+dto.freight || 0) + (+dto.taxes || 0);

    const { data, error } = await this.db.from("purchase_orders").insert({
      tenant_id:        dto.tenantId,
      farm_id:          dto.farmId,
      season_id:        dto.seasonId,
      cost_center_id:   dto.costCenterId,
      partner_id:       dto.partnerId,
      request_id:       dto.requestId,
      quote_id:         dto.quoteId,
      contract_id:      dto.contractId,
      order_date:       dto.orderDate       ?? new Date().toISOString().split("T")[0],
      expected_delivery:dto.expectedDelivery,
      delivery_address: dto.deliveryAddress,
      payment_terms:    dto.paymentTerms,
      payment_method:   dto.paymentMethod,
      currency:         dto.currency        ?? "BRL",
      items:            dto.items           ?? [],
      subtotal,
      discount:         dto.discount        ?? 0,
      freight:          dto.freight         ?? 0,
      taxes:            dto.taxes           ?? 0,
      total_amount:     dto.totalAmount     ?? total,
      notes:            dto.notes,
      tags:             dto.tags            ?? [],
      status:           "draft",
      created_by:       userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateOrder(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", items:"items", subtotal:"subtotal",
      discount:"discount", freight:"freight", taxes:"taxes",
      totalAmount:"total_amount", expectedDelivery:"expected_delivery",
      deliveryAddress:"delivery_address", paymentTerms:"payment_terms",
      notes:"notes", internalNotes:"internal_notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("purchase_orders")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Aprovação de Pedidos ──────────────────────────────────────────────
  async getPendingApprovals(tenantId: string) {
    const { data, error } = await this.db.from("purchase_orders_summary")
      .select("*").eq("tenant_id", tenantId)
      .eq("status", "pending_approval")
      .order("order_date");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async approve(orderId: string, dto: {
    action: "approved" | "rejected" | "returned";
    approver: string; approverId?: string; comments?: string; level?: number;
  }, tenantId: string) {
    // Registra a aprovação
    await this.db.from("purchase_approvals").insert({
      tenant_id:   tenantId,
      order_id:    orderId,
      level:       dto.level   ?? 1,
      action:      dto.action,
      approver:    dto.approver,
      approver_id: dto.approverId,
      comments:    dto.comments,
    });

    const newStatus = dto.action === "approved" ? "approved"
      : dto.action === "rejected" ? "rejected"
      : "draft"; // returned → volta a rascunho

    const update: Record<string, any> = { status: newStatus };
    if (dto.action === "approved") {
      update.approved_by = dto.approver;
      update.approved_at = new Date().toISOString();
    } else if (dto.action === "rejected") {
      update.rejection_reason = dto.comments;
    }

    const { data, error } = await this.db.from("purchase_orders")
      .update(update).eq("id", orderId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async submitForApproval(orderId: string) {
    const { data, error } = await this.db.from("purchase_orders")
      .update({ status: "pending_approval" }).eq("id", orderId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Contratos ─────────────────────────────────────────────────────────
  async findAllContracts(tenantId: string, status?: string) {
    let q = this.db.from("purchase_contracts_summary")
      .select("*").eq("tenant_id", tenantId).order("end_date");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createContract(dto: any, userId?: string) {
    const { data, error } = await this.db.from("purchase_contracts").insert({
      tenant_id:         dto.tenantId,
      farm_id:           dto.farmId,
      partner_id:        dto.partnerId,
      contract_number:   dto.contractNumber,
      title:             dto.title,
      contract_type:     dto.contractType   ?? "supply",
      description:       dto.description,
      items:             dto.items          ?? [],
      total_value:       dto.totalValue,
      start_date:        dto.startDate,
      end_date:          dto.endDate,
      auto_renewal:      dto.autoRenewal    ?? false,
      renewal_notice_days:dto.renewalNoticeDays ?? 30,
      payment_terms:     dto.paymentTerms,
      delivery_terms:    dto.deliveryTerms,
      penalty_clause:    dto.penaltyClause,
      warranty_months:   dto.warrantyMonths,
      signed_at:         dto.signedAt,
      notes:             dto.notes,
      tags:              dto.tags           ?? [],
      created_by:        userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateContract(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      title:"title", description:"description", status:"status",
      endDate:"end_date", totalValue:"total_value", autoRenewal:"auto_renewal",
      paymentTerms:"payment_terms", deliveryTerms:"delivery_terms",
      notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("purchase_contracts")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Entregas / Follow-up ──────────────────────────────────────────────
  async findAllDeliveries(tenantId: string, status?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db.from("purchase_deliveries")
      .select("*, purchase_orders(order_number, partner_id, partners(name))")
      .eq("tenant_id", tenantId)
      .order("expected_date");
    if (status)   q = q.eq("status",        status);
    if (dateFrom) q = q.gte("expected_date", dateFrom);
    if (dateTo)   q = q.lte("expected_date", dateTo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createDelivery(dto: any, userId?: string) {
    const { data, error } = await this.db.from("purchase_deliveries").insert({
      tenant_id:      dto.tenantId,
      order_id:       dto.orderId,
      status:         "pending",
      expected_date:  dto.expectedDate,
      items:          dto.items         ?? [],
      nf_number:      dto.nfNumber,
      transport_name: dto.transportName,
      notes:          dto.notes,
      created_by:     userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async receiveDelivery(id: string, dto: {
    receivedDate: string; receivedBy: string;
    nfNumber?: string; nfValue?: number;
    items: any[]; notes?: string;
  }) {
    const { data, error } = await this.db.from("purchase_deliveries").update({
      status:        "received",
      received_date: dto.receivedDate,
      received_by:   dto.receivedBy,
      nf_number:     dto.nfNumber,
      nf_value:      dto.nfValue,
      items:         dto.items,
      notes:         dto.notes,
    }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);

    // Verifica se todos as entregas do pedido foram recebidas
    const { data: delivery } = await this.db
      .from("purchase_deliveries").select("order_id").eq("id", id).single();
    if (delivery?.order_id) {
      const { data: allDeliveries } = await this.db
        .from("purchase_deliveries").select("status").eq("order_id", delivery.order_id);
      const allReceived = (allDeliveries ?? []).every((d: any) => d.status === "received");
      if (allReceived) {
        await this.db.from("purchase_orders")
          .update({ status: "received" }).eq("id", delivery.order_id);
      }
    }
    return data;
  }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const [reqRes, ordRes, ctRes, delRes] = await Promise.all([
      this.db.from("purchase_requests").select("status").eq("tenant_id", tenantId),
      this.db.from("purchase_orders").select("status, total_amount, order_date, expected_delivery").eq("tenant_id", tenantId),
      this.db.from("purchase_contracts").select("status, end_date").eq("tenant_id", tenantId),
      this.db.from("purchase_deliveries").select("status, expected_date").eq("tenant_id", tenantId),
    ]);
    const reqs = reqRes.data  ?? [];
    const ords = ordRes.data  ?? [];
    const cts  = ctRes.data   ?? [];
    const dels = delRes.data  ?? [];
    const today = new Date().toISOString().split("T")[0];
    const in30  = new Date(Date.now() + 30*86400000).toISOString().split("T")[0];
    return {
      requests_pending:   reqs.filter((r: any) => r.status === "pending").length,
      orders_pending_approval: ords.filter((o: any) => o.status === "pending_approval").length,
      orders_total_month: ords.filter((o: any) => o.order_date?.startsWith(new Date().toISOString().slice(0,7)))
        .reduce((s: number, o: any) => s + (+o.total_amount || 0), 0),
      deliveries_late:    dels.filter((d: any) => d.status === "pending" && d.expected_date < today).length,
      deliveries_today:   dels.filter((d: any) => d.status === "pending" && d.expected_date === today).length,
      contracts_expiring: cts.filter((c: any) => c.status === "active" && c.end_date <= in30).length,
      contracts_active:   cts.filter((c: any) => c.status === "active").length,
    };
  }
}
