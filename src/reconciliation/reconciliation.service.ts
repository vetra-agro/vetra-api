import { Injectable, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class ReconciliationService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Painel de conciliação de uma conta bancária ───────────────────────
  async getReconciliationPanel(
    bankAccountId: string,
    tenantId: string,
    dateFrom: string,
    dateTo: string,
  ) {
    // 1. Lançamentos do extrato (importados OFX/CNAB) não conciliados
    const { data: bankEntries } = await this.db
      .from("cash_flow_entries")
      .select("id, direction, amount, entry_date, description, bank_doc, bank_memo, reconcile_status, external_id, payable_id, receivable_id")
      .eq("bank_account_id", bankAccountId)
      .eq("tenant_id", tenantId)
      .in("reconcile_status", ["unmatched", "matched"])
      .gte("entry_date", dateFrom)
      .lte("entry_date", dateTo)
      .order("entry_date", { ascending: false });

    // 2. Contas a pagar pagas no período — sem lançamento confirmado no extrato
    const { data: payables } = await this.db
      .from("accounts_payable")
      .select("id, description, amount_paid, payment_date, partner_name, document_number, status")
      .eq("bank_account_id", bankAccountId)
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("payment_date", dateFrom)
      .lte("payment_date", dateTo)
      .order("payment_date", { ascending: false });

    // 3. Contas a receber recebidas no período
    const { data: receivables } = await this.db
      .from("accounts_receivable")
      .select("id, description, amount_received, receipt_date, partner_name, document_number, status")
      .eq("bank_account_id", bankAccountId)
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("receipt_date", dateFrom)
      .lte("receipt_date", dateTo)
      .order("receipt_date", { ascending: false });

    const bank = bankEntries ?? [];
    const pays  = payables    ?? [];
    const recs  = receivables ?? [];

    // Quais payable/receivable já têm um cashflow entry casado
    const casedPayableIds   = new Set(bank.filter((e:any)=>e.payable_id).map((e:any)=>e.payable_id));
    const casedReceivableIds= new Set(bank.filter((e:any)=>e.receivable_id).map((e:any)=>e.receivable_id));

    // 4. Saldo do banco (soma dos lançamentos do extrato no período)
    const bankBalance = bank.reduce((s: number, e: any) =>
      s + (e.direction === "in" ? +e.amount : -e.amount), 0);

    // 5. Saldo do ERP (pagamentos + recebimentos lançados no período)
    const erpBalance =
      recs.reduce((s:number,r:any)=>s+(+r.amount_received||0),0) -
      pays.reduce((s:number,r:any)=>s+(+r.amount_paid||0),0);

    return {
      // Extrato bancário — lançamentos do OFX/CNAB
      bank_entries:     bank,
      // Contas do ERP com pagamento/recebimento confirmado
      erp_payables:     pays.map((p:any)=>({ ...p, is_matched: casedPayableIds.has(p.id) })),
      erp_receivables:  recs.map((r:any)=>({ ...r, is_matched: casedReceivableIds.has(r.id) })),
      // Resumo
      summary: {
        bank_total_in:    bank.filter((e:any)=>e.direction==="in").reduce((s:number,e:any)=>s+(+e.amount||0),0),
        bank_total_out:   bank.filter((e:any)=>e.direction==="out").reduce((s:number,e:any)=>s+(+e.amount||0),0),
        bank_balance:     bankBalance,
        erp_balance:      erpBalance,
        difference:       bankBalance - erpBalance,
        unmatched_bank:   bank.filter((e:any)=>e.reconcile_status==="unmatched").length,
        unmatched_erp_pays:  pays.filter((_:any,i:number)=>!casedPayableIds.has(pays[i].id)).length,
        unmatched_erp_recs:  recs.filter((_:any,i:number)=>!casedReceivableIds.has(recs[i].id)).length,
        total_bank_entries: bank.length,
        total_erp_entries:  pays.length + recs.length,
      },
    };
  }

  // ── Conciliar manualmente um par extrato ↔ ERP ─────────────────────────
  async matchManual(dto: {
    cashFlowEntryId:  string;
    payableId?:       string;
    receivableId?:    string;
    tenantId:         string;
  }) {
    const updates: Record<string, any> = {
      reconcile_status: "confirmed",
      reconciled_at:    new Date().toISOString(),
    };
    if (dto.payableId)    updates.payable_id    = dto.payableId;
    if (dto.receivableId) updates.receivable_id = dto.receivableId;

    const { error } = await this.db
      .from("cash_flow_entries")
      .update(updates)
      .eq("id",        dto.cashFlowEntryId)
      .eq("tenant_id", dto.tenantId);

    if (error) throw new BadRequestException(error.message);
    return { matched: true };
  }

  // ── Ignorar lançamento do extrato (taxa bancária, IOF, etc.) ───────────
  async ignoreEntry(entryId: string, tenantId: string) {
    const { error } = await this.db
      .from("cash_flow_entries")
      .update({ reconcile_status: "ignored" })
      .eq("id", entryId)
      .eq("tenant_id", tenantId);

    if (error) throw new BadRequestException(error.message);
    return { ignored: true };
  }

  // ── Criar lançamento de ERP a partir do extrato (lançar o que está só no banco) ──
  async createFromBank(dto: {
    entryId:       string;
    tenantId:      string;
    type:          "payable" | "receivable";
    categoryId?:   string;
    partnerId?:    string;
    costCenterId?: string;
  }) {
    // Busca o lançamento do extrato
    const { data: entry } = await this.db
      .from("cash_flow_entries")
      .select("*")
      .eq("id",        dto.entryId)
      .eq("tenant_id", dto.tenantId)
      .single();

    if (!entry) throw new BadRequestException("Lançamento não encontrado");

    if (dto.type === "payable") {
      const { data, error } = await this.db.from("accounts_payable").insert({
        tenant_id:        dto.tenantId,
        bank_account_id:  entry.bank_account_id,
        category_id:      dto.categoryId,
        partner_id:       dto.partnerId,
        cost_center_id:   dto.costCenterId,
        description:      entry.description || entry.bank_memo,
        amount:           entry.amount,
        amount_paid:      entry.amount,
        due_date:         entry.entry_date,
        payment_date:     entry.entry_date,
        status:           "paid",
        document_number:  entry.bank_doc,
      }).select().single();
      if (error) throw new BadRequestException(error.message);

      // Concilia automaticamente
      await this.db.from("cash_flow_entries").update({
        payable_id: data.id,
        reconcile_status: "confirmed",
        reconciled_at:    new Date().toISOString(),
      }).eq("id", dto.entryId);

      return { created: "payable", id: data.id };
    } else {
      const { data, error } = await this.db.from("accounts_receivable").insert({
        tenant_id:        dto.tenantId,
        bank_account_id:  entry.bank_account_id,
        category_id:      dto.categoryId,
        partner_id:       dto.partnerId,
        cost_center_id:   dto.costCenterId,
        description:      entry.description || entry.bank_memo,
        amount:           entry.amount,
        amount_received:  entry.amount,
        due_date:         entry.entry_date,
        receipt_date:     entry.entry_date,
        status:           "paid",
        document_number:  entry.bank_doc,
      }).select().single();
      if (error) throw new BadRequestException(error.message);

      await this.db.from("cash_flow_entries").update({
        receivable_id:    data.id,
        reconcile_status: "confirmed",
        reconciled_at:    new Date().toISOString(),
      }).eq("id", dto.entryId);

      return { created: "receivable", id: data.id };
    }
  }

  // ── Conciliação automática de uma conta e período ──────────────────────
  async autoReconcilePeriod(bankAccountId: string, tenantId: string, dateFrom: string, dateTo: string) {
    const { data: unmatched } = await this.db
      .from("cash_flow_entries")
      .select("id, direction, amount, entry_date")
      .eq("bank_account_id", bankAccountId)
      .eq("tenant_id",       tenantId)
      .eq("reconcile_status","unmatched")
      .gte("entry_date", dateFrom)
      .lte("entry_date", dateTo);

    let matched = 0;
    for (const entry of (unmatched ?? [])) {
      const dateMin = new Date(new Date(entry.entry_date).getTime() - 3*86400000).toISOString().split("T")[0];
      const dateMax = new Date(new Date(entry.entry_date).getTime() + 3*86400000).toISOString().split("T")[0];

      if (entry.direction === "out") {
        const { data: cands } = await this.db.from("accounts_payable")
          .select("id, amount_paid")
          .eq("tenant_id", tenantId)
          .eq("bank_account_id", bankAccountId)
          .eq("status", "paid")
          .gte("payment_date", dateMin)
          .lte("payment_date", dateMax);

        const hit = (cands ?? []).find((c:any) => Math.abs(+c.amount_paid - +entry.amount) < 0.02);
        if (hit) {
          await this.db.from("cash_flow_entries").update({
            payable_id:       hit.id,
            reconcile_status: "matched",
            reconciled_at:    new Date().toISOString(),
          }).eq("id", entry.id);
          matched++;
        }
      } else {
        const { data: cands } = await this.db.from("accounts_receivable")
          .select("id, amount_received")
          .eq("tenant_id", tenantId)
          .eq("bank_account_id", bankAccountId)
          .eq("status", "paid")
          .gte("receipt_date", dateMin)
          .lte("receipt_date", dateMax);

        const hit = (cands ?? []).find((c:any) => Math.abs(+c.amount_received - +entry.amount) < 0.02);
        if (hit) {
          await this.db.from("cash_flow_entries").update({
            receivable_id:    hit.id,
            reconcile_status: "matched",
            reconciled_at:    new Date().toISOString(),
          }).eq("id", entry.id);
          matched++;
        }
      }
    }
    return { total: (unmatched ?? []).length, matched };
  }
}
