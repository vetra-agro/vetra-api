import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class CreditService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Limites de crédito ──────────────────────────────────────────────────
  async findAllLimits(tenantId: string, status?: string) {
    let q = this.db.from("credit_summary").select("*")
      .eq("tenant_id", tenantId)
      .order("partner_name");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findLimit(id: string, tenantId?: string) {
    let q = this.db.from("credit_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Limite não encontrado");
    return data;
  }

  async upsertLimit(dto: any, userId?: string) {
    // Verifica se já existe para o parceiro
    const { data: existing } = await this.db
      .from("credit_limits")
      .select("id")
      .eq("tenant_id",  dto.tenantId)
      .eq("partner_id", dto.partnerId)
      .maybeSingle();

    const payload = {
      tenant_id:         dto.tenantId,
      partner_id:        dto.partnerId,
      status:            dto.status            ?? "active",
      credit_limit:      dto.creditLimit       ?? 0,
      payment_term_days: dto.paymentTermDays   ?? 30,
      interest_rate_mo:  dto.interestRateMo    ?? 0,
      fine_rate:         dto.fineRate          ?? 2,
      discount_rate:     dto.discountRate      ?? 0,
      risk_score:        dto.riskScore,
      risk_class:        dto.riskClass,
      last_analysis_at:  dto.lastAnalysisAt,
      collateral:        dto.collateral,
      guarantor_name:    dto.guarantorName,
      approved_by:       dto.approvedBy,
      approved_at:       dto.approvedAt,
      review_date:       dto.reviewDate,
      notes:             dto.notes,
      created_by:        userId,
    };

    if (existing) {
      const { data, error } = await this.db
        .from("credit_limits").update(payload).eq("id", existing.id).select().single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }

    const { data, error } = await this.db
      .from("credit_limits").insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateLimitStatus(id: string, status: string, tenantId?: string) {
    const { error } = await this.db
      .from("credit_limits").update({ status }).eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { id, status };
  }

  // ── Casos de cobrança ───────────────────────────────────────────────────
  async findAllCases(tenantId: string, status?: string, page = 1, limit = 50) {
    const from = (page - 1) * limit;
    let q = this.db.from("collection_summary")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("days_overdue", { ascending: false, nullsFirst: false })
      .range(from, from + limit - 1);
    if (status) q = q.eq("status", status);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async findCase(id: string, tenantId?: string) {
    let q = this.db.from("collection_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Caso não encontrado");

    // Busca histórico de contatos
    const { data: contacts } = await this.db
      .from("collection_contacts")
      .select("*")
      .eq("case_id", id)
      .order("contacted_at", { ascending: false });

    return { ...data, contacts: contacts ?? [] };
  }

  async createCase(dto: any, userId?: string) {
    // Verifica se já existe caso aberto para o parceiro
    const { data: existing } = await this.db
      .from("collection_cases")
      .select("id, status")
      .eq("tenant_id",  dto.tenantId)
      .eq("partner_id", dto.partnerId)
      .not("status",    "in", '("written_off","recovered")')
      .maybeSingle();

    if (existing) throw new ConflictException("Já existe um caso de cobrança aberto para este parceiro");

    const { data, error } = await this.db.from("collection_cases").insert({
      tenant_id:       dto.tenantId,
      partner_id:      dto.partnerId,
      credit_limit_id: dto.creditLimitId,
      status:          "open",
      case_number:     dto.caseNumber,
      total_debt:      dto.totalDebt,
      total_interest:  dto.totalInterest  ?? 0,
      total_fine:      dto.totalFine      ?? 0,
      receivable_ids:  dto.receivableIds  ?? [],
      opened_at:       dto.openedAt       ?? new Date().toISOString().split("T")[0],
      due_since:       dto.dueSince,
      next_contact_at: dto.nextContactAt,
      assigned_to:     dto.assignedTo,
      notes:           dto.notes,
      tags:            dto.tags           ?? [],
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Suspende o limite de crédito automaticamente
    if (dto.creditLimitId) {
      await this.db.from("credit_limits")
        .update({ status: "suspended" })
        .eq("id", dto.creditLimitId);
    }

    return data;
  }

  async updateCase(id: string, dto: any, tenantId?: string) {
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      status:"status", totalDebt:"total_debt", totalInterest:"total_interest",
      totalFine:"total_fine", totalRecovered:"total_recovered",
      nextContactAt:"next_contact_at", lastContactAt:"last_contact_at",
      agreedDate:"agreed_date", writtenOffAt:"written_off_at",
      assignedTo:"assigned_to", legalProcess:"legal_process",
      caseNumber:"case_number", notes:"notes", tags:"tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db
      .from("collection_cases").update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Histórico de contatos ───────────────────────────────────────────────
  async addContact(dto: any) {
    const { data, error } = await this.db.from("collection_contacts").insert({
      case_id:      dto.caseId,
      tenant_id:    dto.tenantId,
      contact_type: dto.contactType ?? "call",
      contacted_at: dto.contactedAt ?? new Date().toISOString(),
      contacted_by: dto.contactedBy,
      summary:      dto.summary,
      next_action:  dto.nextAction,
      next_date:    dto.nextDate,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Atualiza last_contact e next_contact no caso
    const updates: any = { last_contact_at: (dto.contactedAt ?? new Date().toISOString()).split("T")[0] };
    if (dto.nextDate) updates.next_contact_at = dto.nextDate;
    await this.db.from("collection_cases").update(updates).eq("id", dto.caseId);

    return data;
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  async getStats(tenantId: string) {
    const [limitsRes, casesRes] = await Promise.all([
      this.db.from("credit_limits")
        .select("status, credit_limit, used_credit, usage_pct")
        .eq("tenant_id", tenantId),
      this.db.from("collection_cases")
        .select("status, total_debt, total_recovered, days_overdue")
        .eq("tenant_id", tenantId),
    ]);

    const limits = limitsRes.data ?? [];
    const cases  = casesRes.data  ?? [];
    const open   = cases.filter((c: any) => !["written_off","recovered"].includes(c.status));

    return {
      // Crédito
      total_partners_with_limit: limits.length,
      total_credit_granted:  limits.reduce((s:number,l:any)=>s+(+l.credit_limit||0),0),
      total_credit_used:     limits.reduce((s:number,l:any)=>s+(+l.used_credit||0),0),
      suspended_limits:      limits.filter((l:any)=>l.status==="suspended").length,
      blocked_limits:        limits.filter((l:any)=>l.status==="blocked").length,
      // Cobrança
      open_cases:            open.length,
      total_debt_open:       open.reduce((s:number,c:any)=>s+(+c.total_debt||0),0),
      avg_days_overdue:      open.length
        ? Math.round(open.reduce((s:number,c:any)=>s+(+c.days_overdue||0),0)/open.length)
        : 0,
      total_recovered:       cases.filter((c:any)=>c.status==="recovered")
        .reduce((s:number,c:any)=>s+(+c.total_recovered||0),0),
      in_legal:              cases.filter((c:any)=>c.status==="legal").length,
    };
  }

  // ── Carteira vencida (aging) ────────────────────────────────────────────
  async getAgingReport(tenantId: string) {
    const { data } = await this.db
      .from("accounts_receivable")
      .select("partner_id, amount_remaining, due_date")
      .eq("tenant_id", tenantId)
      .in("status", ["pending","partial","overdue"]);

    const today = new Date();
    const buckets = { current:0, d1_30:0, d31_60:0, d61_90:0, d91_plus:0 };
    const byPartner: Record<string, any> = {};

    for (const r of (data ?? [])) {
      const days = Math.floor((today.getTime() - new Date(r.due_date).getTime()) / 86400000);
      const amt  = +r.amount_remaining || 0;

      if (days <= 0)       buckets.current  += amt;
      else if (days <= 30) buckets.d1_30    += amt;
      else if (days <= 60) buckets.d31_60   += amt;
      else if (days <= 90) buckets.d61_90   += amt;
      else                 buckets.d91_plus += amt;

      if (r.partner_id) {
        if (!byPartner[r.partner_id]) byPartner[r.partner_id] = { partner_id: r.partner_id, total: 0, max_days: 0 };
        byPartner[r.partner_id].total    += amt;
        byPartner[r.partner_id].max_days  = Math.max(byPartner[r.partner_id].max_days, Math.max(0, days));
      }
    }

    // Enriquece com nomes dos parceiros
    const partnerIds = Object.keys(byPartner);
    if (partnerIds.length > 0) {
      const { data: partners } = await this.db
        .from("partners").select("id, name, type").in("id", partnerIds);
      (partners ?? []).forEach((p: any) => {
        if (byPartner[p.id]) { byPartner[p.id].name = p.name; byPartner[p.id].type = p.type; }
      });
    }

    return {
      buckets,
      total: Object.values(buckets).reduce((s: number, v) => s + v, 0),
      by_partner: Object.values(byPartner)
        .sort((a: any, b: any) => b.total - a.total)
        .slice(0, 20),
    };
  }
}
