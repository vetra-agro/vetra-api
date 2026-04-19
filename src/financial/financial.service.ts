import { Injectable } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class FinancialService {
  constructor(private supabase: SupabaseProvider) {}

  async create(farmId: string, dto: CreateTransactionDto) {
    const { data, error } = await this.supabase.getClient()
      .from('transactions')
      .insert({ ...dto, farm_id: farmId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findByFarm(farmId: string, from?: string, to?: string) {
    let query = this.supabase.getClient()
      .from('transactions')
      .select('*')
      .eq('farm_id', farmId)
      .order('date', { ascending: false });

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }

  async getSummary(farmId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('transactions')
      .select('type, amount')
      .eq('farm_id', farmId);

    if (error) throw new Error(error.message);

    const income = data.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    return {
      income,
      expense,
      balance: income - expense,
      transactions: data.length,
    };
  }
}
