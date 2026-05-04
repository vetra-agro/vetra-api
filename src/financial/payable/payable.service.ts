import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class PayableService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(filters: {
    tenantId?: string; farmId?: string; status?: string;
    categoryId?: string; partnerId?: string; seasonId?: string;
    dateFrom?: string; dateTo?: string; page?: number; limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const from = (page - 1) * limit;

    let q = this.db.from("payable_summary").select("*", { count: "exact" })
      .order("due_date").range(from, from + limit - 1);

    if (filters.tenantId)   q = q.eq("tenant_id",   filters.tenantId);
    if (filters.farmId)     q = q.eq("farm_id",      filters.farmId);
    if (filters.status)     q = q.eq("status",       filters.status);
    if (filters.categoryId) q = q.eq("category_id",  filters.categoryId);
    if (filters.partnerId)  q = q.eq("partner_id",   filters.partnerId);
    if (filters.seasonId)   q = q.eq("season_id",    filters.seasonId);
    if (filters.dateFrom)   q = q.gte("due_date",    filters.dateFrom);
    if (filters.dateTo)     q = q.lte("due_date",    filters.dateTo);

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit, pages: Math.ceil((count ?? 0) / limit) } };
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("payable_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Conta a pagar não encontrada");
    return data;
  }

  async create(dto: any, userId?: string) {
    const { data, error } = await this.db.from("accounts_payable").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId,
      cost_center_id:  dto.costCenterId,
      category_id:     dto.categoryId,
      bank_account_id: dto.bankAccountId,
      partner_id:      dto.partnerId,
      season_id:       dto.seasonId,
      description:     dto.description,
      document_number: dto.documentNumber,
      document_type:   dto.documentType,
      amount:          dto.amount,
      discount:        dto.discount ?? 0,
      interest:        dto.interest ?? 0,
      fine:            dto.fine ?? 0,
      amount_paid:     dto.amountPaid ?? 0,
      issue_date:      dto.issueDate,
      due_date:        dto.dueDate,
      payment_date:    dto.paymentDate,
      competence_date: dto.competenceDate,
      status:          dto.status ?? "pending",
      payment_method:  dto.paymentMethod,
      recurrence:      dto.recurrence ?? "none",
      recurrence_end:  dto.recurrenceEnd,
      apportionment:   dto.apportionment ?? [],
      notes:           dto.notes,
      tags:            dto.tags ?? [],
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: any, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      description:"description", documentNumber:"document_number", documentType:"document_type",
      amount:"amount", discount:"discount", interest:"interest", fine:"fine",
      amountPaid:"amount_paid", issueDate:"issue_date", dueDate:"due_date",
      paymentDate:"payment_date", competenceDate:"competence_date",
      status:"status", paymentMethod:"payment_method",
      costCenterId:"cost_center_id", categoryId:"category_id",
      bankAccountId:"bank_account_id", partnerId:"partner_id",
      seasonId:"season_id", farmId:"farm_id",
      notes:"notes", tags:"tags", apportionment:"apportionment",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("accounts_payable")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async pay(id: string, dto: { amountPaid: number; paymentDate: string; paymentMethod?: string; bankAccountId?: string }, tenantId?: string) {
    const current = await this.findOne(id, tenantId);
    const totalPaid = (+current.amount_paid || 0) + dto.amountPaid;
    const { data, error } = await this.db.from("accounts_payable").update({
      amount_paid:     totalPaid,
      payment_date:    dto.paymentDate,
      payment_method:  dto.paymentMethod,
      bank_account_id: dto.bankAccountId ?? current.bank_account_id,
    }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);

    // Atualiza saldo da conta bancária se informada
    if (dto.bankAccountId) {
      await this.db.rpc("decrement_bank_balance", {
        p_account_id: dto.bankAccountId,
        p_amount:     dto.amountPaid,
      }).then(() => null, () => null);
    }
    return data;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    const { error } = await this.db.from("accounts_payable").delete().eq("id", id);
    if (error) throw new BadRequestException(error.message);
    return { message: "Conta a pagar removida" };
  }

  async getStats(tenantId: string, farmId?: string, dateFrom?: string, dateTo?: string) {
    let q = this.db.from("accounts_payable")
      .select("status, amount, amount_paid, amount_remaining, due_date")
      .eq("tenant_id", tenantId);
    if (farmId)   q = q.eq("farm_id", farmId);
    if (dateFrom) q = q.gte("due_date", dateFrom);
    if (dateTo)   q = q.lte("due_date", dateTo);
    const { data } = await q;
    const all = data ?? [];
    const today = new Date().toISOString().split("T")[0];
    const next30 = new Date(Date.now() + 30*86400000).toISOString().split("T")[0];
    return {
      total:           all.length,
      pending_count:   all.filter((r:any) => r.status === "pending").length,
      overdue_count:   all.filter((r:any) => r.status === "overdue" || (r.status === "pending" && r.due_date < today)).length,
      paid_count:      all.filter((r:any) => r.status === "paid").length,
      total_amount:    all.reduce((s:number,r:any)=>s+(+r.amount||0),0),
      total_paid:      all.reduce((s:number,r:any)=>s+(+r.amount_paid||0),0),
      total_remaining: all.reduce((s:number,r:any)=>s+(+r.amount_remaining||0),0),
      due_next_30:     all.filter((r:any)=>r.due_date>=today&&r.due_date<=next30&&r.status!=="paid")
                         .reduce((s:number,r:any)=>s+(+r.amount_remaining||0),0),
    };
  }

  async getCategories(tenantId: string) {
    const { data } = await this.db.from("financial_categories").select("*")
      .eq("type", "expense")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("name");
    return data ?? [];
  }
}
