import { Injectable, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class CashFlowService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async getEntries(filters: {
    tenantId: string; bankAccountId?: string; farmId?: string;
    direction?: string; reconcileStatus?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 100, 500);
    const from  = (page - 1) * limit;

    let q = this.db.from("cash_flow_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", filters.tenantId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (filters.bankAccountId)  q = q.eq("bank_account_id",  filters.bankAccountId);
    if (filters.farmId)         q = q.eq("farm_id",          filters.farmId);
    if (filters.direction)      q = q.eq("direction",         filters.direction);
    if (filters.reconcileStatus)q = q.eq("reconcile_status",  filters.reconcileStatus);
    if (filters.dateFrom)       q = q.gte("entry_date",       filters.dateFrom);
    if (filters.dateTo)         q = q.lte("entry_date",       filters.dateTo);

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async createEntry(dto: any, userId?: string) {
    const { data, error } = await this.db.from("cash_flow_entries").insert({
      tenant_id:        dto.tenantId,
      bank_account_id:  dto.bankAccountId,
      cost_center_id:   dto.costCenterId,
      category_id:      dto.categoryId,
      farm_id:          dto.farmId,
      season_id:        dto.seasonId,
      direction:        dto.direction,
      origin:           dto.origin ?? "manual",
      description:      dto.description,
      amount:           dto.amount,
      entry_date:       dto.entryDate,
      value_date:       dto.valueDate,
      reconcile_status: dto.reconcileStatus ?? "unmatched",
      bank_memo:        dto.bankMemo,
      bank_doc:         dto.bankDoc,
      external_id:      dto.externalId,
      import_batch_id:  dto.importBatchId,
      notes:            dto.notes,
      tags:             dto.tags ?? [],
      created_by:       userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateEntry(id: string, dto: any) {
    const map: Record<string, string> = {
      description:"description", amount:"amount", entryDate:"entry_date",
      valueDate:"value_date", categoryId:"category_id", costCenterId:"cost_center_id",
      bankAccountId:"bank_account_id", farmId:"farm_id", seasonId:"season_id",
      reconcileStatus:"reconcile_status", notes:"notes", tags:"tags",
    };
    const updates: Record<string, any> = {};
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    if (dto.reconcileStatus === "confirmed") updates.reconciled_at = new Date().toISOString();
    const { data, error } = await this.db.from("cash_flow_entries")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteEntry(id: string) {
    const { error } = await this.db.from("cash_flow_entries").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // ── Importação em lote (OFX/CNAB) ──────────────────────────────────────
  async importEntries(dto: {
    tenantId: string; bankAccountId: string;
    format: string; filename?: string;
    entries: Array<{
      externalId: string; direction: string; amount: number;
      entryDate: string; valueDate?: string; description: string;
      bankDoc?: string; bankMemo?: string;
    }>;
    dateFrom?: string; dateTo?: string;
  }, userId?: string) {
    // Cria o lote de importação
    const { data: batch, error: batchError } = await this.db.from("import_batches").insert({
      tenant_id:       dto.tenantId,
      bank_account_id: dto.bankAccountId,
      format:          dto.format,
      filename:        dto.filename,
      entry_count:     dto.entries.length,
      date_from:       dto.dateFrom,
      date_to:         dto.dateTo,
      imported_by:     userId,
    }).select().single();
    if (batchError) throw new BadRequestException(batchError.message);

    // Verifica quais external_ids já existem (evita duplicatas)
    const externalIds = dto.entries.map(e => e.externalId).filter(Boolean);
    const { data: existing } = await this.db.from("cash_flow_entries")
      .select("external_id")
      .eq("bank_account_id", dto.bankAccountId)
      .in("external_id", externalIds);

    const existingIds = new Set((existing ?? []).map((r: any) => r.external_id));

    // Insere apenas os novos
    const toInsert = dto.entries
      .filter(e => !existingIds.has(e.externalId))
      .map(e => ({
        tenant_id:        dto.tenantId,
        bank_account_id:  dto.bankAccountId,
        direction:        e.direction,
        origin:           dto.format === "ofx" ? "ofx_import" : "cnab_import",
        description:      e.description,
        amount:           e.amount,
        entry_date:       e.entryDate,
        value_date:       e.valueDate,
        reconcile_status: "unmatched",
        bank_memo:        e.bankMemo,
        bank_doc:         e.bankDoc,
        external_id:      e.externalId,
        import_batch_id:  batch.id,
        created_by:       userId,
      }));

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error: insertError } = await this.db.from("cash_flow_entries").insert(toInsert);
      if (insertError) throw new BadRequestException(insertError.message);
      inserted = toInsert.length;
    }

    // Tenta conciliação automática com payable/receivable
    const matched = await this.autoReconcile(dto.tenantId, dto.bankAccountId, batch.id);

    // Atualiza contagem do lote
    await this.db.from("import_batches")
      .update({ entry_count: inserted, matched_count: matched })
      .eq("id", batch.id);

    return {
      batchId:   batch.id,
      total:     dto.entries.length,
      inserted,
      skipped:   dto.entries.length - inserted,
      matched,
    };
  }

  // ── Conciliação automática ──────────────────────────────────────────────
  async autoReconcile(tenantId: string, bankAccountId: string, batchId?: string): Promise<number> {
    // Busca entradas não conciliadas do lote
    let q = this.db.from("cash_flow_entries")
      .select("id, direction, amount, entry_date, description")
      .eq("tenant_id", tenantId)
      .eq("bank_account_id", bankAccountId)
      .eq("reconcile_status", "unmatched");
    if (batchId) q = q.eq("import_batch_id", batchId);
    const { data: entries } = await q;

    let matched = 0;
    for (const entry of (entries ?? [])) {
      // Tenta achar um payable (saída) ou receivable (entrada) com valor e data próximos
      if (entry.direction === "out") {
        const { data: candidates } = await this.db.from("accounts_payable")
          .select("id, payment_date, amount_paid")
          .eq("tenant_id", tenantId)
          .eq("bank_account_id", bankAccountId)
          .eq("status", "paid")
          .gte("payment_date", new Date(new Date(entry.entry_date).getTime() - 3*86400000).toISOString().split("T")[0])
          .lte("payment_date", new Date(new Date(entry.entry_date).getTime() + 3*86400000).toISOString().split("T")[0]);

        const match = (candidates ?? []).find((c: any) =>
          Math.abs(+c.amount_paid - entry.amount) < 0.02
        );
        if (match) {
          await this.db.from("cash_flow_entries").update({
            reconcile_status: "matched",
            reconciled_at:    new Date().toISOString(),
            payable_id:       match.id,
          }).eq("id", entry.id);
          matched++;
        }
      } else {
        const { data: candidates } = await this.db.from("accounts_receivable")
          .select("id, receipt_date, amount_received")
          .eq("tenant_id", tenantId)
          .eq("bank_account_id", bankAccountId)
          .eq("status", "paid")
          .gte("receipt_date", new Date(new Date(entry.entry_date).getTime() - 3*86400000).toISOString().split("T")[0])
          .lte("receipt_date", new Date(new Date(entry.entry_date).getTime() + 3*86400000).toISOString().split("T")[0]);

        const match = (candidates ?? []).find((c: any) =>
          Math.abs(+c.amount_received - entry.amount) < 0.02
        );
        if (match) {
          await this.db.from("cash_flow_entries").update({
            reconcile_status: "matched",
            reconciled_at:    new Date().toISOString(),
            receivable_id:    match.id,
          }).eq("id", entry.id);
          matched++;
        }
      }
    }
    return matched;
  }

  // ── KPIs e saldo ───────────────────────────────────────────────────────
  async getSummary(tenantId: string, bankAccountId?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db.from("cash_flow_entries")
      .select("direction, amount, entry_date, reconcile_status")
      .eq("tenant_id", tenantId);
    if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
    if (dateFrom)      q = q.gte("entry_date", dateFrom);
    if (dateTo)        q = q.lte("entry_date", dateTo);
    const { data } = await q;
    const all = data ?? [];

    const totalIn  = all.filter((r:any)=>r.direction==="in").reduce((s:number,r:any)=>s+(+r.amount||0),0);
    const totalOut = all.filter((r:any)=>r.direction==="out").reduce((s:number,r:any)=>s+(+r.amount||0),0);

    return {
      total_in:       totalIn,
      total_out:      totalOut,
      net:            totalIn - totalOut,
      entries_count:  all.length,
      unmatched:      all.filter((r:any)=>r.reconcile_status==="unmatched").length,
      matched:        all.filter((r:any)=>["matched","confirmed"].includes(r.reconcile_status)).length,
    };
  }

  async getDailyBalance(tenantId: string, bankAccountId?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db.from("daily_balance")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("entry_date");
    if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
    if (dateFrom)      q = q.gte("entry_date", dateFrom);
    if (dateTo)        q = q.lte("entry_date", dateTo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getImportHistory(tenantId: string) {
    const { data, error } = await this.db.from("import_batches")
      .select("*, bank_accounts(name)")
      .eq("tenant_id", tenantId)
      .order("imported_at", { ascending: false })
      .limit(20);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
