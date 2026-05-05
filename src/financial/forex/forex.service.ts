import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class ForexService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Busca taxa de câmbio atual (via API pública) ──────────────────────
  async getCurrentRate(currency = "USD"): Promise<number | null> {
    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.rates?.BRL ?? null;
    } catch { return null; }
  }

  // ── Operações ─────────────────────────────────────────────────────────
  async findAllOperations(filters: {
    tenantId: string; farmId?: string; seasonId?: string;
    status?: string; currency?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from  = (page - 1) * limit;

    let q = this.db.from("forex_operations_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", filters.tenantId)
      .order("due_date")
      .range(from, from + limit - 1);

    if (filters.farmId)   q = q.eq("farm_id",  filters.farmId);
    if (filters.seasonId) q = q.eq("season_id",filters.seasonId);
    if (filters.status)   q = q.eq("status",   filters.status);
    if (filters.currency) q = q.eq("currency", filters.currency);

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async createOperation(dto: any, userId?: string) {
    const { data, error } = await this.db.from("forex_operations").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId,
      season_id:       dto.seasonId,
      partner_id:      dto.partnerId,
      operation_type:  dto.operationType  ?? "spot",
      direction:       dto.direction       ?? "sell",
      currency:        dto.currency        ?? "USD",
      foreign_amount:  dto.foreignAmount,
      contracted_rate: dto.contractedRate,
      contracted_at:   dto.contractedAt   ?? new Date().toISOString().split("T")[0],
      due_date:        dto.dueDate,
      contract_number: dto.contractNumber,
      bank_name:       dto.bankName,
      notes:           dto.notes,
      tags:            dto.tags           ?? [],
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateOperation(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", settlementRate:"settlement_rate",
      settlementBrl:"settlement_brl", settlementDate:"settlement_date",
      dueDate:"due_date", foreignAmount:"foreign_amount",
      contractedRate:"contracted_rate", contractNumber:"contract_number",
      bankName:"bank_name", notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db
      .from("forex_operations").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async settleOperation(id: string, dto: { settlementRate: number; settlementDate: string; settlementBrl?: number }) {
    const settlementBrl = dto.settlementBrl ??
      (await this.db.from("forex_operations").select("foreign_amount").eq("id", id).single())
        .data?.foreign_amount * dto.settlementRate;

    const { data, error } = await this.db.from("forex_operations").update({
      settlement_rate: dto.settlementRate,
      settlement_date: dto.settlementDate,
      settlement_brl:  settlementBrl,
      status:          "settled",
    }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeOperation(id: string) {
    const { error } = await this.db.from("forex_operations").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // ── Contratos ─────────────────────────────────────────────────────────
  async findAllContracts(tenantId: string, farmId?: string, seasonId?: string) {
    let q = this.db.from("forex_contracts_summary")
      .select("*").eq("tenant_id", tenantId)
      .order("delivery_start", { nullsFirst: false });
    if (farmId)   q = q.eq("farm_id",   farmId);
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createContract(dto: any, userId?: string) {
    const { data, error } = await this.db.from("forex_contracts").insert({
      tenant_id:      dto.tenantId,
      farm_id:        dto.farmId,
      season_id:      dto.seasonId,
      partner_id:     dto.partnerId,
      contract_number:dto.contractNumber,
      contract_type:  dto.contractType  ?? "cpr",
      description:    dto.description,
      commodity:      dto.commodity     ?? "Soja",
      quantity_sc:    dto.quantitySc,
      quantity_ton:   dto.quantityTon,
      unit_price_usd: dto.unitPriceUsd,
      unit_price_brl: dto.unitPriceBrl,
      total_usd:      dto.totalUsd,
      total_brl:      dto.totalBrl,
      reference_rate: dto.referenceRate,
      currency:       dto.currency      ?? "USD",
      signed_at:      dto.signedAt,
      delivery_start: dto.deliveryStart,
      delivery_end:   dto.deliveryEnd,
      payment_date:   dto.paymentDate,
      notes:          dto.notes,
      tags:           dto.tags          ?? [],
      created_by:     userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateContract(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      description:"description", contractNumber:"contract_number",
      contractType:"contract_type", commodity:"commodity",
      quantitySc:"quantity_sc", quantityTon:"quantity_ton",
      unitPriceUsd:"unit_price_usd", totalUsd:"total_usd",
      totalBrl:"total_brl", referenceRate:"reference_rate",
      deliveryStart:"delivery_start", deliveryEnd:"delivery_end",
      paymentDate:"payment_date", status:"status",
      notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db
      .from("forex_contracts").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Vínculos operação × contrato ──────────────────────────────────────
  async linkOperationToContract(dto: { tenantId: string; operationId: string; contractId: string; linkedUsd: number; notes?: string }) {
    // Valida se a operação tem saldo disponível
    const { data: op } = await this.db
      .from("forex_operations").select("foreign_amount, status").eq("id", dto.operationId).single();
    if (!op || op.status === "cancelled") throw new BadRequestException("Operação inválida ou cancelada");

    // Calcula quanto desta operação já está vinculado
    const { data: existing } = await this.db
      .from("forex_links").select("linked_usd").eq("operation_id", dto.operationId);
    const alreadyLinked = (existing ?? []).reduce((s: number, l: any) => s + +l.linked_usd, 0);
    const available = +op.foreign_amount - alreadyLinked;

    if (dto.linkedUsd > available + 0.01)
      throw new BadRequestException(`Operação só tem USD ${available.toFixed(2)} disponível para vincular`);

    const { data, error } = await this.db.from("forex_links").insert({
      tenant_id:   dto.tenantId,
      operation_id:dto.operationId,
      contract_id: dto.contractId,
      linked_usd:  dto.linkedUsd,
      notes:       dto.notes,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async unlinkOperation(linkId: string) {
    const { error } = await this.db.from("forex_links").delete().eq("id", linkId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async getContractLinks(contractId: string) {
    const { data, error } = await this.db
      .from("forex_links")
      .select("*, forex_operations(operation_type, contracted_rate, foreign_amount, due_date, status, bank_name)")
      .eq("contract_id", contractId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Exposição cambial ─────────────────────────────────────────────────
  async getExposure(tenantId: string, farmId?: string, seasonId?: string) {
    let q = this.db.from("forex_exposure_summary").select("*").eq("tenant_id", tenantId);
    if (farmId)   q = q.eq("farm_id",   farmId);
    if (seasonId) q = q.eq("season_id", seasonId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    // Busca taxa atual
    const currentRate = await this.getCurrentRate("USD");
    return { exposure: data ?? [], current_rate: currentRate };
  }

  // ── Simulação de cenários ─────────────────────────────────────────────
  async simulate(dto: {
    tenantId: string;
    farmId?: string;
    seasonId?: string;
    scenarios: Array<{ name: string; rate: number }>;
  }) {
    // Busca operações abertas
    const { data: ops } = await this.db
      .from("forex_operations")
      .select("foreign_amount, contracted_rate, direction, currency, due_date")
      .eq("tenant_id", dto.tenantId)
      .eq("status", "open");

    // Busca contratos com exposição aberta
    const { data: contracts } = await this.db
      .from("forex_contracts_summary")
      .select("total_usd, hedged_usd, open_exposure_usd, commodity, reference_rate")
      .eq("tenant_id", dto.tenantId)
      .not("status", "eq", "settled");

    if (dto.farmId) {
      // Filtra por fazenda se necessário
    }

    const allOps      = ops       ?? [];
    const allContracts= contracts ?? [];

    const totalHedgedUsd    = allOps.reduce((s: number, o: any) => s + +o.foreign_amount, 0);
    const totalExposureUsd  = allContracts.reduce((s: number, c: any) => s + (+c.open_exposure_usd || 0), 0);
    const avgContractedRate = totalHedgedUsd > 0
      ? allOps.reduce((s: number, o: any) => s + +o.foreign_amount * +o.contracted_rate, 0) / totalHedgedUsd
      : 0;

    return {
      base: {
        total_hedged_usd:    totalHedgedUsd,
        total_exposure_usd:  totalExposureUsd,
        avg_contracted_rate: avgContractedRate,
      },
      scenarios: dto.scenarios.map(sc => {
        // Operações: valor já travado — recebe pela taxa contratada
        const hedgedBrl = totalHedgedUsd * avgContractedRate;
        // Exposição aberta: recebe pela taxa do cenário
        const exposureBrl = totalExposureUsd * sc.rate;
        // Total BRL projetado
        const totalBrl = hedgedBrl + exposureBrl;
        // Diferença vs cenário base (taxa contratada p/ tudo)
        const baseBrl = (totalHedgedUsd + totalExposureUsd) * avgContractedRate;
        const diff = totalBrl - baseBrl;
        return {
          name:          sc.name,
          rate:          sc.rate,
          hedged_brl:    Math.round(hedgedBrl * 100) / 100,
          exposure_brl:  Math.round(exposureBrl * 100) / 100,
          total_brl:     Math.round(totalBrl * 100) / 100,
          diff_vs_base:  Math.round(diff * 100) / 100,
          diff_pct:      baseBrl > 0 ? Math.round((diff / baseBrl) * 10000) / 100 : 0,
        };
      }),
    };
  }

  // ── KPIs gerais ───────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const [opsRes, ctRes] = await Promise.all([
      this.db.from("forex_operations")
        .select("status, foreign_amount, contracted_rate, brl_amount, fx_result, direction, currency")
        .eq("tenant_id", tenantId),
      this.db.from("forex_contracts")
        .select("status, total_usd, hedged_usd, hedged_pct")
        .eq("tenant_id", tenantId),
    ]);

    const ops       = opsRes.data  ?? [];
    const contracts = ctRes.data   ?? [];
    const open      = ops.filter((o: any) => o.status === "open");
    const settled   = ops.filter((o: any) => o.status === "settled");

    const currentRate = await this.getCurrentRate("USD");

    return {
      // Operações
      open_operations:    open.length,
      settled_operations: settled.length,
      open_usd:   open.reduce((s: number, o: any) => s + +o.foreign_amount, 0),
      open_brl:   open.reduce((s: number, o: any) => s + +o.brl_amount,    0),
      total_fx_result: settled.reduce((s: number, o: any) => s + (+o.fx_result || 0), 0),
      // Contratos
      total_contracts:       contracts.length,
      fully_hedged:          contracts.filter((c: any) => c.status === "fully_hedged").length,
      partial_hedged:        contracts.filter((c: any) => c.status === "partial").length,
      total_contracted_usd:  contracts.reduce((s: number, c: any) => s + (+c.total_usd   || 0), 0),
      total_hedged_usd:      contracts.reduce((s: number, c: any) => s + (+c.hedged_usd  || 0), 0),
      total_exposure_usd:    contracts.reduce((s: number, c: any) =>
        s + ((+c.total_usd || 0) - (+c.hedged_usd || 0)), 0),
      current_usd_rate:      currentRate,
    };
  }
}
