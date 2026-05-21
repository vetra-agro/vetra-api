import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class ExportService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── KPIs ──────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const [cRes, fRes, sRes] = await Promise.all([
      this.db.from("export_contracts").select("status,qty_contracted,qty_shipped,total_usd,shipment_end")
        .eq("tenant_id", tenantId),
      this.db.from("export_forex").select("status,qty_usd,rate_contracted,rate_market")
        .eq("tenant_id", tenantId).in("status",["open","partial"]),
      this.db.from("export_shipments").select("status,etd,eta")
        .eq("tenant_id", tenantId).not("status","in","(cancelled,delivered)"),
    ]);
    const contracts = cRes.data ?? [];
    const forex     = fRes.data ?? [];
    const shipments = sRes.data ?? [];
    const active    = contracts.filter((c:any) => ["active","partial"].includes(c.status));
    const today     = new Date().toISOString().split("T")[0];
    const in30      = new Date(Date.now()+30*86400000).toISOString().split("T")[0];
    return {
      contracts_active:  active.length,
      qty_contracted:    active.reduce((s:number,c:any)=>s+(+c.qty_contracted||0),0),
      qty_shipped:       active.reduce((s:number,c:any)=>s+(+c.qty_shipped||0),0),
      revenue_usd:       active.reduce((s:number,c:any)=>s+(+c.total_usd||0),0),
      forex_open_usd:    forex.reduce((s:number,f:any)=>s+(+f.qty_usd||0),0),
      shipments_transit: shipments.filter((s:any)=>s.status==="in_transit").length,
      expiring_30d:      contracts.filter((c:any)=>["active","partial"].includes(c.status)&&c.shipment_end<=in30).length,
      docs_pending:      0, // preenchido separado se necessário
    };
  }

  // ── Contratos ──────────────────────────────────────────────────────────
  async findAllContracts(tenantId: string, status?: string, seasonId?: string) {
    let q = this.db.from("export_contracts_summary").select("*").eq("tenant_id", tenantId)
      .order("shipment_end");
    if (status)   q = q.eq("status",    status);
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertContract(dto: any, userId?: string) {
    const rawQtyContracted = dto.qtyContracted ?? dto.qty_contracted;
    const qtyContracted =
      rawQtyContracted === undefined || rawQtyContracted === null || rawQtyContracted === ""
        ? null
        : +rawQtyContracted;

    if (!dto.id && (qtyContracted === null || Number.isNaN(qtyContracted))) {
      throw new BadRequestException("qtyContracted (ou qty_contracted) é obrigatório para criar contrato");
    }

    const payload = {
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId         || null,
      season_id:       dto.seasonId       || null,
      partner_id:      dto.partnerId      || null,
      contract_number: dto.contractNumber || null,
      status:          dto.status         ?? "draft",
      crop:            dto.crop,
      product_desc:    dto.productDesc    || null,
      unit:            dto.unit           ?? "mt",
      qty_contracted:  qtyContracted,
      price_usd:       dto.priceUsd       ? +dto.priceUsd       : null,
      price_brl:       dto.priceBrl       ? +dto.priceBrl       : null,
      exchange_rate:   dto.exchangeRate   ? +dto.exchangeRate   : null,
      incoterm:        dto.incoterm       ?? "FOB",
      port_origin:     dto.portOrigin     || null,
      port_dest:       dto.portDest       || null,
      country_dest:    dto.countryDest    || null,
      buyer_name:      dto.buyerName      || null,
      buyer_country:   dto.buyerCountry   || null,
      signed_at:       dto.signedAt       || null,
      shipment_start:  dto.shipmentStart  || null,
      shipment_end:    dto.shipmentEnd,
      notes:           dto.notes          || null,
      tags:            dto.tags           ?? [],
      created_by:      userId,
    };

    if (dto.id && qtyContracted === null) {
      delete (payload as any).qty_contracted;
    }

    if (qtyContracted !== null && Number.isNaN(qtyContracted)) {
      throw new BadRequestException("qtyContracted (ou qty_contracted) deve ser numérico");
    }

    if (dto.id) {
      const { data, error } = await this.db.from("export_contracts")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("export_contracts")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async registerShipment(contractId: string, dto: { qtyShipped: number }) {
    const { data: c } = await this.db.from("export_contracts")
      .select("qty_shipped, qty_contracted").eq("id", contractId).single();
    if (!c) throw new NotFoundException("Contrato não encontrado");
    const newQty = (c.qty_shipped ?? 0) + dto.qtyShipped;
    if (newQty > c.qty_contracted + 0.001)
      throw new BadRequestException(`Quantidade embarcada (${newQty}) supera o contratado (${c.qty_contracted})`);
    const { data, error } = await this.db.from("export_contracts")
      .update({ qty_shipped: newQty }).eq("id", contractId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Documentos ─────────────────────────────────────────────────────────
  async findAllDocs(tenantId: string, contractId?: string, docType?: string) {
    let q = this.db.from("export_documents")
      .select("*, export_contracts(contract_number,crop)")
      .eq("tenant_id", tenantId).order("doc_date", { ascending: false });
    if (contractId) q = q.eq("contract_id", contractId);
    if (docType)    q = q.eq("doc_type",    docType);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertDoc(dto: any) {
    const payload = {
      tenant_id:    dto.tenantId,
      contract_id:  dto.contractId  || null,
      shipment_id:  dto.shipmentId  || null,
      doc_type:     dto.docType,
      status:       dto.status      ?? "pending",
      doc_number:   dto.docNumber   || null,
      doc_date:     dto.docDate     || null,
      expiry_date:  dto.expiryDate  || null,
      re_number:    dto.reNumber    || null,
      due_number:   dto.dueNumber   || null,
      bl_number:    dto.blNumber    || null,
      vessel_name:  dto.vesselName  || null,
      voyage_number:dto.voyageNumber|| null,
      issuer:       dto.issuer      || null,
      file_url:     dto.fileUrl     || null,
      notes:        dto.notes       || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("export_documents")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("export_documents")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Câmbio / Hedge ─────────────────────────────────────────────────────
  async findAllForex(tenantId: string, status?: string) {
    let q = this.db.from("export_forex")
      .select("*, export_contracts(contract_number,crop), partners(name)")
      .eq("tenant_id", tenantId).order("contracted_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertForex(dto: any) {
    const qtyBrl = dto.qtyUsd && dto.rateContracted
      ? Math.round(+dto.qtyUsd * +dto.rateContracted * 100) / 100 : null;
    const payload = {
      tenant_id:       dto.tenantId,
      contract_id:     dto.contractId    || null,
      bank_partner_id: dto.bankPartnerId || null,
      op_type:         dto.opType        ?? "acc",
      status:          dto.status        ?? "open",
      qty_usd:         +dto.qtyUsd,
      rate_contracted: +dto.rateContracted,
      rate_market:     dto.rateMarket    ? +dto.rateMarket    : null,
      qty_brl:         dto.qtyBrl        ? +dto.qtyBrl        : qtyBrl,
      contracted_at:   dto.contractedAt  || new Date().toISOString().split("T")[0],
      expiry_date:     dto.expiryDate,
      settled_at:      dto.settledAt     || null,
      interest_rate:   dto.interestRate  ? +dto.interestRate  : null,
      advance_pct:     dto.advancePct    ? +dto.advancePct    : null,
      advance_usd:     dto.advanceUsd    ? +dto.advanceUsd    : null,
      rate_settlement: dto.rateSettlement? +dto.rateSettlement: null,
      bank_ref:        dto.bankRef       || null,
      notes:           dto.notes         || null,
    };
    if (dto.pnlBrl || (dto.rateSettlement && dto.rateContracted)) {
      (payload as any).pnl_brl = dto.pnlBrl
        ? +dto.pnlBrl
        : Math.round((+dto.rateSettlement - +dto.rateContracted) * +dto.qtyUsd * 100) / 100;
    }
    if (dto.id) {
      const { data, error } = await this.db.from("export_forex")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("export_forex")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Embarques ──────────────────────────────────────────────────────────
  async findAllShipments(tenantId: string, status?: string, contractId?: string) {
    let q = this.db.from("export_shipments")
      .select("*, export_contracts(contract_number,crop,buyer_name)")
      .eq("tenant_id", tenantId).order("etd");
    if (status)     q = q.eq("status",      status);
    if (contractId) q = q.eq("contract_id", contractId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertShipment(dto: any) {
    const totalCost = (+dto.freightUsd||0) + (+dto.insuranceUsd||0) + (+dto.otherCostsUsd||0);
    const payload = {
      tenant_id:       dto.tenantId,
      contract_id:     dto.contractId    || null,
      shipment_number: dto.shipmentNumber|| null,
      status:          dto.status        ?? "planned",
      crop:            dto.crop,
      qty_mt:          +dto.qtyMt,
      qty_bu:          dto.qtyBu         ? +dto.qtyBu       : null,
      port_loading:    dto.portLoading,
      port_discharge:  dto.portDischarge,
      country_dest:    dto.countryDest   || null,
      incoterm:        dto.incoterm      ?? "FOB",
      vessel_name:     dto.vesselName    || null,
      voyage_number:   dto.voyageNumber  || null,
      flag:            dto.flag          || null,
      agent:           dto.agent         || null,
      container_count: dto.containerCount? +dto.containerCount: null,
      container_type:  dto.containerType || null,
      etd:             dto.etd           || null,
      eta:             dto.eta           || null,
      atd:             dto.atd           || null,
      ata:             dto.ata           || null,
      freight_usd:     dto.freightUsd    ? +dto.freightUsd   : null,
      insurance_usd:   dto.insuranceUsd  ? +dto.insuranceUsd : null,
      other_costs_usd: dto.otherCostsUsd ? +dto.otherCostsUsd: null,
      total_cost_usd:  totalCost > 0     ? totalCost         : null,
      bl_number:       dto.blNumber      || null,
      bl_date:         dto.blDate        || null,
      notes:           dto.notes         || null,
    };
    if (dto.id) {
      const { data, error } = await this.db.from("export_shipments")
        .update(payload).eq("id", dto.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }
    const { data, error } = await this.db.from("export_shipments")
      .insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    // Atualiza qty_shipped no contrato
    if (data.contract_id) {
      await this.registerShipment(data.contract_id, { qtyShipped: data.qty_mt });
    }
    return data;
  }

  async advanceShipmentStatus(id: string, next: string) {
    const { data, error } = await this.db.from("export_shipments")
      .update({ status: next }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}

