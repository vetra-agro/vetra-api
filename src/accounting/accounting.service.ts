import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class AccountingService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Plano de Contas ───────────────────────────────────────────────────
  async getChartOfAccounts(tenantId: string, groupType?: string) {
    let q = this.db
      .from("chart_of_accounts")
      .select("*")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq("active", true)
      .order("code");
    if (groupType) q = q.eq("group_type", groupType);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createAccount(dto: any) {
    // Calcula nível pela profundidade do código
    const level = dto.code.split(".").length;
    const { data, error } = await this.db.from("chart_of_accounts").insert({
      tenant_id:      dto.tenantId,
      parent_id:      dto.parentId,
      code:           dto.code,
      name:           dto.name,
      description:    dto.description,
      nature:         dto.nature,
      group_type:     dto.groupType,
      level,
      is_analytic:    dto.isAnalytic      ?? true,
      accepts_entries:dto.acceptsEntries  ?? true,
      dre_line:       dto.dreLine,
      active:         true,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateAccount(id: string, dto: any) {
    const { data, error } = await this.db
      .from("chart_of_accounts")
      .update({ name: dto.name, description: dto.description, active: dto.active, dre_line: dto.dreLine })
      .eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Lançamentos Contábeis ─────────────────────────────────────────────
  async findAllEntries(tenantId: string, filters: {
    status?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    let q = this.db
      .from("accounting_entries")
      .select("*, accounting_entry_items(*, chart_of_accounts(code, name, nature))", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("entry_date", { ascending: false })
      .range((page-1)*limit, page*limit-1);
    if (filters.status)   q = q.eq("status",     filters.status);
    if (filters.dateFrom) q = q.gte("entry_date", filters.dateFrom);
    if (filters.dateTo)   q = q.lte("entry_date", filters.dateTo);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async createEntry(dto: any, userId?: string) {
    // Cria o cabeçalho
    const { data: entry, error } = await this.db.from("accounting_entries").insert({
      tenant_id:      dto.tenantId,
      farm_id:        dto.farmId,
      season_id:      dto.seasonId,
      cost_center_id: dto.costCenterId,
      entry_number:   dto.entryNumber,
      status:         "draft",
      entry_date:     dto.entryDate,
      description:    dto.description,
      reference:      dto.reference,
      notes:          dto.notes,
      created_by:     userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Insere as partidas
    if (dto.items?.length > 0) {
      const items = dto.items.map((item: any, i: number) => ({
        entry_id:      entry.id,
        account_id:    item.accountId,
        sequence:      i + 1,
        debit_amount:  item.debitAmount  ?? 0,
        credit_amount: item.creditAmount ?? 0,
        description:   item.description,
      }));
      const { error: itemsError } = await this.db.from("accounting_entry_items").insert(items);
      if (itemsError) throw new BadRequestException(itemsError.message);
    }

    return this.db.from("accounting_entries")
      .select("*, accounting_entry_items(*, chart_of_accounts(code, name))")
      .eq("id", entry.id).single().then(r => r.data);
  }

  async postEntry(id: string, userId?: string) {
    const { data: entry } = await this.db.from("accounting_entries").select("*").eq("id", id).single();
    if (!entry) throw new NotFoundException("Lançamento não encontrado");
    if (!entry.is_balanced) throw new BadRequestException("Lançamento não está balanceado (débitos ≠ créditos)");
    const { data, error } = await this.db.from("accounting_entries")
      .update({ status: "posted", posting_date: new Date().toISOString().split("T")[0], posted_by: userId })
      .eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async reverseEntry(id: string, description: string, userId?: string) {
    const { data: original } = await this.db
      .from("accounting_entries")
      .select("*, accounting_entry_items(*)")
      .eq("id", id).single();
    if (!original || original.status !== "posted")
      throw new BadRequestException("Somente lançamentos escriturados podem ser estornados");

    // Cria o estorno (inverte débitos e créditos)
    const reversal = await this.createEntry({
      tenantId:    original.tenant_id,
      farmId:      original.farm_id,
      seasonId:    original.season_id,
      costCenterId:original.cost_center_id,
      entryDate:   new Date().toISOString().split("T")[0],
      description: description ?? `ESTORNO: ${original.description}`,
      reference:   original.reference,
      items: original.accounting_entry_items.map((item: any) => ({
        accountId:    item.account_id,
        debitAmount:  item.credit_amount,  // inverte
        creditAmount: item.debit_amount,   // inverte
        description:  `Estorno: ${item.description ?? ""}`,
      })),
    }, userId);

    // Posta o estorno
    await this.postEntry(reversal.id, userId);

    // Marca o original como estornado
    await this.db.from("accounting_entries")
      .update({ status: "reversed" })
      .eq("id", id);

    return reversal;
  }

  // ── DRE ───────────────────────────────────────────────────────────────
  async getDRE(tenantId: string, dateFrom: string, dateTo: string, farmId?: string) {
    let q = this.db.from("dre_by_period")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("period", dateFrom)
      .lte("period", dateTo);
    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    const all = data ?? [];
    // Agrupa por linha do DRE
    const group = (line: string) =>
      all.filter((r: any) => r.dre_line === line).reduce((s: number, r: any) => s + (+r.amount || 0), 0);

    const receita_bruta  = group("receita_bruta");
    const deducoes       = group("deducoes");
    const receita_liq    = receita_bruta - deducoes;
    const cogs           = group("cogs");
    const lucro_bruto    = receita_liq - cogs;
    const opex           = group("opex");
    const ebitda         = lucro_bruto - opex;
    const financial      = group("financial");
    const lucro_liq      = ebitda - financial;

    return {
      period: { from: dateFrom, to: dateTo },
      lines: all,
      summary: {
        receita_bruta,
        deducoes,
        receita_liquida: receita_liq,
        cogs,
        lucro_bruto,
        margem_bruta_pct: receita_liq > 0 ? Math.round(lucro_bruto / receita_liq * 1000) / 10 : null,
        opex,
        ebitda,
        margem_ebitda_pct: receita_liq > 0 ? Math.round(ebitda / receita_liq * 1000) / 10 : null,
        financial,
        lucro_liquido: lucro_liq,
        margem_liquida_pct: receita_liq > 0 ? Math.round(lucro_liq / receita_liq * 1000) / 10 : null,
      },
    };
  }

  // ── Ativos ─────────────────────────────────────────────────────────────
  async findAllAssets(tenantId: string, status?: string, farmId?: string) {
    let q = this.db.from("assets").select("*, farms(name), chart_of_accounts(code, name)")
      .eq("tenant_id", tenantId).order("name");
    if (status) q = q.eq("status", status);
    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createAsset(dto: any, userId?: string) {
    const { data, error } = await this.db.from("assets").insert({
      tenant_id:           dto.tenantId,
      farm_id:             dto.farmId,
      account_id:          dto.accountId,
      machinery_id:        dto.machineryId,
      code:                dto.code,
      name:                dto.name,
      description:         dto.description,
      category:            dto.category,
      acquisition_date:    dto.acquisitionDate,
      acquisition_value:   dto.acquisitionValue,
      supplier_name:       dto.supplierName,
      invoice_number:      dto.invoiceNumber,
      depreciation_method: dto.depreciationMethod ?? "straight_line",
      useful_life_months:  dto.usefulLifeMonths   ?? 60,
      residual_value:      dto.residualValue       ?? 0,
      notes:               dto.notes,
      tags:                dto.tags               ?? [],
      created_by:          userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateAsset(id: string, dto: any) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", description:"description", category:"category",
      status:"status", usefulLifeMonths:"useful_life_months",
      residualValue:"residual_value", notes:"notes",
      disposalDate:"disposal_date", disposalValue:"disposal_value",
      disposalReason:"disposal_reason", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("assets")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Calcular e lançar depreciação mensal de um ativo
  async depreciateAsset(assetId: string, year: number, month: number, tenantId: string) {
    const { data: asset } = await this.db.from("assets").select("*").eq("id", assetId).single();
    if (!asset) throw new NotFoundException("Ativo não encontrado");
    if (asset.status === "disposed" || asset.status === "fully_depreciated")
      throw new BadRequestException("Ativo não pode ser depreciado");

    // Verifica se já foi calculado neste período
    const { data: existing } = await this.db.from("asset_depreciations")
      .select("id").eq("asset_id", assetId).eq("period_year", year).eq("period_month", month).maybeSingle();
    if (existing) throw new BadRequestException("Depreciação já lançada neste período");

    // Calcula depreciação mensal (linear)
    const depAmt = Math.min(
      (asset.acquisition_value - (asset.residual_value ?? 0)) / asset.useful_life_months,
      Math.max(0, (asset.net_book_value ?? asset.acquisition_value) - (asset.residual_value ?? 0))
    );

    const accAfter  = (asset.accumulated_depreciation ?? 0) + depAmt;
    const netAfter  = Math.max(asset.residual_value ?? 0, asset.acquisition_value - accAfter);

    // Insere o registro de depreciação
    const { data: dep, error } = await this.db.from("asset_depreciations").insert({
      asset_id: assetId, tenant_id: tenantId,
      period_year: year, period_month: month,
      depreciation_amt: Math.round(depAmt * 100) / 100,
      accumulated_after: Math.round(accAfter * 100) / 100,
      net_value_after:   Math.round(netAfter * 100) / 100,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Atualiza o ativo
    await this.db.from("assets")
      .update({ accumulated_depreciation: accAfter })
      .eq("id", assetId);

    return dep;
  }

  // Depreciar todos os ativos ativos de um tenant no período
  async depreciateAll(tenantId: string, year: number, month: number) {
    const { data: activeAssets } = await this.db.from("assets")
      .select("id").eq("tenant_id", tenantId).in("status", ["active","idle"]);
    const results: Array<{ assetId: string; status: string; amount?: number; reason?: string }> = [];
    for (const a of (activeAssets ?? [])) {
      try {
        const dep = await this.depreciateAsset(a.id, year, month, tenantId);
        results.push({ assetId: a.id, status: "ok", amount: dep.depreciation_amt });
      } catch (e: any) {
        results.push({ assetId: a.id, status: "skip", reason: e.message });
      }
    }
    return results;
  }

  // KPIs
  async getStats(tenantId: string) {
    const [assetsRes, entriesRes] = await Promise.all([
      this.db.from("assets")
        .select("status, acquisition_value, accumulated_depreciation, net_book_value")
        .eq("tenant_id", tenantId),
      this.db.from("accounting_entries")
        .select("status").eq("tenant_id", tenantId),
    ]);
    const assets  = assetsRes.data  ?? [];
    const entries = entriesRes.data ?? [];
    const active  = assets.filter((a: any) => !["disposed"].includes(a.status));
    return {
      total_assets:     assets.length,
      active_assets:    active.length,
      total_cost:       active.reduce((s: number, a: any) => s + (+a.acquisition_value || 0), 0),
      total_net_value:  active.reduce((s: number, a: any) => s + (+a.net_book_value    || 0), 0),
      total_depreciated:active.reduce((s: number, a: any) => s + (+a.accumulated_depreciation || 0), 0),
      posted_entries:   entries.filter((e: any) => e.status === "posted").length,
      draft_entries:    entries.filter((e: any) => e.status === "draft").length,
    };
  }
}
