import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../../database/supabase.provider";

@Injectable()
export class BanksService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(tenantId: string, farmId?: string) {
    let q = this.db.from("bank_accounts").select("*")
      .eq("tenant_id", tenantId).eq("active", true).order("is_default", { ascending: false }).order("name");
    if (farmId) q = q.eq("farm_id", farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("bank_accounts").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Conta bancária não encontrada");
    return data;
  }

  async create(dto: any, userId?: string) {
    // Garante apenas um default por tenant
    if (dto.isDefault) {
      await this.db.from("bank_accounts").update({ is_default: false }).eq("tenant_id", dto.tenantId);
    }
    const { data, error } = await this.db.from("bank_accounts").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId,
      name:            dto.name,
      bank_name:       dto.bankName,
      bank_code:       dto.bankCode,
      agency:          dto.agency,
      account_number:  dto.accountNumber,
      account_type:    dto.accountType ?? "checking",
      pix_key:         dto.pixKey,
      current_balance: dto.currentBalance ?? 0,
      initial_balance: dto.initialBalance ?? 0,
      initial_date:    dto.initialDate,
      is_default:      dto.isDefault ?? false,
      notes:           dto.notes,
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: any, tenantId?: string) {
    await this.findOne(id, tenantId);
    if (dto.isDefault) {
      await this.db.from("bank_accounts").update({ is_default: false })
        .eq("tenant_id", tenantId!).neq("id", id);
    }
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      name:"name", bankName:"bank_name", bankCode:"bank_code",
      agency:"agency", accountNumber:"account_number", accountType:"account_type",
      pixKey:"pix_key", currentBalance:"current_balance", isDefault:"is_default",
      active:"active", notes:"notes",
    };
    for (const [k,col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("bank_accounts")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getStats(tenantId: string) {
    const { data } = await this.db.from("bank_accounts")
      .select("account_type, current_balance, active")
      .eq("tenant_id", tenantId).eq("active", true);
    const all = data ?? [];
    return {
      total_accounts: all.length,
      total_balance:  all.reduce((s: number, a: any) => s + (+a.current_balance || 0), 0),
      by_type:        all.reduce((acc: any, a: any) => {
        acc[a.account_type] = (acc[a.account_type] ?? 0) + (+a.current_balance || 0);
        return acc;
      }, {}),
    };
  }

  // Lista de bancos brasileiros mais comuns
  getBankList() {
    return [
      { code:"001", name:"Banco do Brasil" },      { code:"033", name:"Santander" },
      { code:"104", name:"Caixa Econômica" },       { code:"237", name:"Bradesco" },
      { code:"341", name:"Itaú" },                  { code:"756", name:"Sicoob" },
      { code:"748", name:"Sicredi" },               { code:"260", name:"Nu Pagamentos (Nubank)" },
      { code:"336", name:"C6 Bank" },               { code:"077", name:"Inter" },
      { code:"208", name:"BTG Pactual" },           { code:"422", name:"Safra" },
      { code:"655", name:"Votorantim" },            { code:"041", name:"Banrisul" },
      { code:"004", name:"BNB" },                   { code:"021", name:"BANESE" },
      { code:"085", name:"AILOS" },                 { code:"136", name:"Unicred" },
    ];
  }
}
