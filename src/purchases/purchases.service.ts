import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class PurchasesService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Aprovadores / Alçadas ──────────────────────────────────────────────
  async findAllApprovers(tenantId: string, farmId?: string) {
    let q = this.db.from("purchase_approvers").select("*")
      .eq("tenant_id", tenantId).eq("active", true)
      .order("level").order("min_value");
    if (farmId) q = q.or(`farm_id.eq.${farmId},farm_id.is.null`);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertApprover(dto: any) {
    const payload = {
      tenant_id:          dto.tenantId,
      farm_id:            dto.farmId            || null,
      name:               dto.name,
      email:              dto.email             || null,
      role:               dto.role              || null,
      user_id:            dto.userId            || null,
      level:              dto.level             ?? 1,
      min_value:          dto.minValue          ?? 0,
      max_value:          dto.maxValue          ?? null,
      categories:         dto.categories        ?? [],
      approves_requests:  dto.approvesRequests  ?? true,
      approves_orders:    dto.approvesOrders    ?? true,
      active:             dto.active            ?? true,
      notes:              dto.notes             || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("purchase_approvers")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("purchase_approvers")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteApprover(id: string) {
    const { error } = await this.db.from("purchase_approvers")
      .update({ active: false }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Encontra aprovadores necessários para um valor
  async getRequiredApprovers(tenantId: string, value: number, farmId?: string) {
    const { data, error } = await this.db.rpc("get_required_approver", {
      p_tenant_id: tenantId,
      p_value:     value,
      p_farm_id:   farmId || null,
    });
    if (error) {
      // Fallback: query direta se RPC não disponível
      let q = this.db.from("purchase_approvers").select("*")
        .eq("tenant_id", tenantId).eq("active", true).eq("approves_orders", true)
        .lte("min_value", value).order("level").limit(1);
      const { data: fallback } = await q;
      return fallback ?? [];
    }
    return data ?? [];
  }

  // ── Requisições ───────────────────────────────────────────────────────
  async findAllRequests(tenantId: string, status?: string, farmId?: string) {
    let q = this.db.from("purchase_requests")
      .select("*, farms(name), seasons(name,crop), cost_centers(name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
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

  // Criar cotação a partir de uma requisição aprovada
  async createQuoteFromRequest(requestId: string, dto: { tenantId: string; deadline?: string }, userId?: string) {
    const { data: req } = await this.db.from("purchase_requests")
      .select("*").eq("id", requestId).single();
    if (!req) throw new NotFoundException("Requisição não encontrada");
    if (req.status !== "approved")
      throw new BadRequestException("Somente requisições aprovadas podem gerar cotações");

    // Mapeia itens da requisição para o formato de cotação
    const quoteItems = (req.items ?? []).map((i: any) => ({
      product: i.product,
      unit:    i.unit,
      qty:     i.qty,
      notes:   i.notes,
    }));

    const { data, error } = await this.db.from("purchase_quotes").insert({
      tenant_id:  dto.tenantId,
      request_id: requestId,
      farm_id:    req.farm_id,
      title:      `Cotação — ${req.title}`,
      deadline:   dto.deadline,
      items:      quoteItems,
      status:     "open",
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Atualiza status da requisição
    await this.db.from("purchase_requests")
      .update({ status: "ordered" }).eq("id", requestId);

    return data;
  }

  // ── Cotações ──────────────────────────────────────────────────────────
  async findAllQuotes(tenantId: string, status?: string) {
    let q = this.db.from("purchase_quotes")
      .select(`
        *,
        purchase_requests(title, estimated_total, items),
        purchase_quote_responses(id, partner_name, total_amount, is_winner, partners(name))
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createQuote(dto: any, userId?: string) {
    if ((!dto.items || dto.items.length === 0) && !dto.requestId)
      throw new BadRequestException("Uma cotação precisa ter ao menos um item ou estar vinculada a uma requisição");
    const { data, error } = await this.db.from("purchase_quotes").insert({
      tenant_id:  dto.tenantId,
      request_id: dto.requestId,
      farm_id:    dto.farmId,
      title:      dto.title,
      deadline:   dto.deadline,
      items:      dto.items ?? [],
      status:     "open",
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addQuoteResponse(dto: any) {
    const { data: quote } = await this.db.from("purchase_quotes")
      .select("items").eq("id", dto.quoteId).single();
    if (!quote) throw new NotFoundException("Cotação não encontrada");

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
    const { data: quote } = await this.db.from("purchase_quotes")
      .select("*, purchase_requests(title, items)").eq("id", quoteId).single();
    const { data: responses } = await this.db.from("purchase_quote_responses")
      .select("*, partners(name,document)").eq("quote_id", quoteId)
      .order("total_amount", { nullsFirst: false });
    if (!quote) throw new NotFoundException("Cotação não encontrada");

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
      const prices   = supplierPrices.filter((s: any) => s.unit_price != null);
      const minPrice = prices.length > 0 ? Math.min(...prices.map((s: any) => +s.unit_price)) : null;
      return { ...item, suppliers: supplierPrices, min_price: minPrice };
    });

    return { quote, responses: resps, comparison };
  }

  async awardQuote(quoteId: string, responseId: string, tenantId: string) {
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

  // Busca parceiros corretamente (coluna é types, não type)
  async getPartners(tenantId: string) {
    const { data, error } = await this.db.from("partners")
      .select("id, name, document, types, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .contains("types", ["supplier"])  // usa contains para array
      .order("name");
    if (error) {
      // fallback sem filtro de tipo se a query falhar
      const { data: all } = await this.db.from("partners")
        .select("id, name, document, types, status")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("name");
      return all ?? [];
    }
    return data ?? [];
  }

  async createOrder(dto: any, userId?: string) {
    const subtotal = (dto.items ?? []).reduce((s: number, i: any) =>
      s + (+i.qty || 0) * (+i.unit_price || 0), 0);
    const total = subtotal - (+dto.discount || 0) + (+dto.freight || 0) + (+dto.taxes || 0);

    // Determina nível de alçada necessário
    const approvers = await this.getRequiredApprovers(dto.tenantId, total, dto.farmId);
    const approvalLevel = approvers.length > 0 ? (approvers[0] as any).level : 1;

    const { data, error } = await this.db.from("purchase_orders").insert({
      tenant_id:         dto.tenantId,
      farm_id:           dto.farmId,
      season_id:         dto.seasonId,
      cost_center_id:    dto.costCenterId,
      partner_id:        dto.partnerId,
      request_id:        dto.requestId,
      quote_id:          dto.quoteId,
      contract_id:       dto.contractId,
      order_date:        dto.orderDate        ?? new Date().toISOString().split("T")[0],
      expected_delivery: dto.expectedDelivery,
      delivery_address:  dto.deliveryAddress,
      payment_terms:     dto.paymentTerms,
      payment_method:    dto.paymentMethod,
      currency:          dto.currency         ?? "BRL",
      items:             dto.items            ?? [],
      subtotal,
      discount:          dto.discount         ?? 0,
      freight:           dto.freight          ?? 0,
      taxes:             dto.taxes            ?? 0,
      total_amount:      dto.totalAmount      ?? total,
      approval_level:    approvalLevel,
      notes:             dto.notes,
      tags:              dto.tags             ?? [],
      status:            "draft",
      created_by:        userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Criar pedido a partir de uma cotação adjudicada
  async createOrderFromQuote(quoteId: string, responseId: string, dto: any, userId?: string) {
    const { data: response } = await this.db.from("purchase_quote_responses")
      .select("*, purchase_quotes(*, purchase_requests(farm_id, season_id, cost_center_id))")
      .eq("id", responseId).single();
    if (!response) throw new NotFoundException("Resposta de cotação não encontrada");

    const quote   = (response as any).purchase_quotes;
    const request = quote?.purchase_requests;

    // Resolve o partner_id — obrigatório em purchase_orders
    let partnerId = response.partner_id ?? dto.partnerId ?? null;

    if (!partnerId && response.partner_name) {
      // Fornecedor foi digitado manualmente (sem cadastro).
      // Tenta encontrar pelo nome no tenant antes de criar.
      const { data: existing } = await this.db.from("partners")
        .select("id")
        .eq("tenant_id", dto.tenantId)
        .ilike("name", response.partner_name.trim())
        .limit(1)
        .maybeSingle();

      if (existing) {
        partnerId = existing.id;
      } else {
        // Cria o parceiro automaticamente como fornecedor
        const { data: created, error: createErr } = await this.db.from("partners").insert({
          tenant_id: dto.tenantId,
          name:      response.partner_name.trim(),
          types:     ["supplier"],
          status:    "active",
        }).select("id").single();

        if (createErr)
          throw new BadRequestException(
            `Fornecedor "${response.partner_name}" não está cadastrado e não foi possível criá-lo automaticamente. Cadastre-o em Administração → Parceiros antes de gerar o pedido.`
          );

        partnerId = created.id;

        // Vincula o partner_id na resposta da cotação para futura referência
        await this.db.from("purchase_quote_responses")
          .update({ partner_id: partnerId })
          .eq("id", responseId);
      }
    }

    if (!partnerId)
      throw new BadRequestException(
        "Não foi possível identificar o fornecedor. Certifique-se de que o fornecedor vencedor está cadastrado em Administração → Parceiros."
      );

    return this.createOrder({
      tenantId:         dto.tenantId,
      farmId:           request?.farm_id        ?? dto.farmId,
      seasonId:         request?.season_id       ?? dto.seasonId,
      costCenterId:     request?.cost_center_id  ?? dto.costCenterId,
      partnerId,
      quoteId,
      requestId:        quote?.request_id,
      expectedDelivery: dto.expectedDelivery,
      paymentTerms:     response.payment_terms,
      items:            (response.items ?? []).map((i: any) => ({
        product:    i.product,
        unit:       i.unit,
        qty:        i.qty,
        unit_price: i.unit_price,
        notes:      i.notes,
      })),
      discount: 0, freight: 0, taxes: 0,
    }, userId);
  }

  // Criar pedido a partir de um contrato
  async createOrderFromContract(contractId: string, dto: any, userId?: string) {
    const { data: contract } = await this.db.from("purchase_contracts")
      .select("*").eq("id", contractId).single();
    if (!contract) throw new NotFoundException("Contrato não encontrado");
    if (contract.status !== "active")
      throw new BadRequestException("Somente contratos ativos podem gerar pedidos");

    return this.createOrder({
      tenantId:         dto.tenantId,
      farmId:           contract.farm_id,
      partnerId:        contract.partner_id,
      contractId,
      paymentTerms:     contract.payment_terms,
      expectedDelivery: dto.expectedDelivery,
      items:            dto.items ?? [],
      notes:            `Gerado a partir do contrato ${contract.contract_number ?? contract.title}`,
    }, userId);
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

  async submitForApproval(orderId: string) {
    const { data: order } = await this.db.from("purchase_orders")
      .select("total_amount, farm_id, tenant_id").eq("id", orderId).single();
    if (!order) throw new NotFoundException("Pedido não encontrado");

    // Identifica aprovadores necessários e registra no pedido
    const approvers = await this.getRequiredApprovers(
      order.tenant_id, order.total_amount, order.farm_id
    );

    const { data, error } = await this.db.from("purchase_orders")
      .update({
        status:        "pending_approval",
        approval_level: approvers.length > 0 ? (approvers[0] as any).level : 1,
      })
      .eq("id", orderId).select().single();
    if (error) throw new BadRequestException(error.message);

    return {
      order: data,
      required_approvers: approvers,
    };
  }

  // ── Aprovação de Pedidos ──────────────────────────────────────────────
  async getPendingApprovals(tenantId: string) {
    const { data, error } = await this.db.from("purchase_orders_summary")
      .select("*")
      .eq("tenant_id",   tenantId)
      .eq("status",      "pending_approval")
      .order("order_date");
    if (error) throw new BadRequestException(error.message);

    // Enriquece com o aprovador necessário para cada pedido
    const enriched = await Promise.all((data ?? []).map(async (order: any) => {
      const approvers = await this.getRequiredApprovers(
        tenantId, order.total_amount, order.farm_id
      );
      return { ...order, required_approvers: approvers };
    }));
    return enriched;
  }

  async approve(orderId: string, dto: {
    action: "approved" | "rejected" | "returned";
    approver: string; approverId?: string; comments?: string; level?: number;
  }, tenantId: string) {
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
      : "draft";

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
      tenant_id:           dto.tenantId,
      farm_id:             dto.farmId,
      partner_id:          dto.partnerId,
      contract_number:     dto.contractNumber,
      title:               dto.title,
      contract_type:       dto.contractType     ?? "supply",
      description:         dto.description,
      items:               dto.items            ?? [],
      total_value:         dto.totalValue,
      start_date:          dto.startDate,
      end_date:            dto.endDate,
      auto_renewal:        dto.autoRenewal      ?? false,
      renewal_notice_days: dto.renewalNoticeDays ?? 30,
      payment_terms:       dto.paymentTerms,
      delivery_terms:      dto.deliveryTerms,
      penalty_clause:      dto.penaltyClause,
      warranty_months:     dto.warrantyMonths,
      signed_at:           dto.signedAt,
      notes:               dto.notes,
      tags:                dto.tags             ?? [],
      created_by:          userId,
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

  // ── Entregas ──────────────────────────────────────────────────────────
  async findAllDeliveries(tenantId: string, status?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db.from("purchase_deliveries")
      .select("*, purchase_orders(order_number, partner_id, partners(name))")
      .eq("tenant_id", tenantId).order("expected_date");
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
    nfNumber?: string; nfValue?: number; items: any[]; notes?: string;
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

    const { data: delivery } = await this.db.from("purchase_deliveries")
      .select("order_id").eq("id", id).single();
    if (delivery?.order_id) {
      const { data: allDels } = await this.db.from("purchase_deliveries")
        .select("status").eq("order_id", delivery.order_id);
      const allReceived = (allDels ?? []).every((d: any) => d.status === "received");
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
    const reqs  = reqRes.data  ?? [];
    const ords  = ordRes.data  ?? [];
    const cts   = ctRes.data   ?? [];
    const dels  = delRes.data  ?? [];
    const today = new Date().toISOString().split("T")[0];
    const in30  = new Date(Date.now() + 30*86400000).toISOString().split("T")[0];
    const month = new Date().toISOString().slice(0, 7);
    return {
      requests_pending:         reqs.filter((r: any) => r.status === "pending").length,
      orders_pending_approval:  ords.filter((o: any) => o.status === "pending_approval").length,
      orders_total_month:       ords.filter((o: any) => o.order_date?.startsWith(month))
                                    .reduce((s: number, o: any) => s + (+o.total_amount || 0), 0),
      deliveries_late:          dels.filter((d: any) => d.status === "pending" && d.expected_date < today).length,
      deliveries_today:         dels.filter((d: any) => d.status === "pending" && d.expected_date === today).length,
      contracts_expiring:       cts.filter((c: any) => c.status === "active" && c.end_date <= in30).length,
      contracts_active:         cts.filter((c: any) => c.status === "active").length,
    };
  }
}