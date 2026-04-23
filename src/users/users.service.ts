import {
  Injectable, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private supabase: SupabaseProvider) {}

  // ── Listar todos os usuários ────────────────────────────────
  async findAll(filters?: { role?: string; active?: boolean; search?: string }) {
    let query = this.supabase
      .getAdminClient()
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.role)            query = query.eq('role', filters.role);
    if (filters?.active != null)  query = query.eq('active', filters.active);
    if (filters?.search) {
      query = query.or(
        `full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Buscar usuário por ID ──────────────────────────────────
  async findOne(id: string) {
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Usuário não encontrado');
    return data;
  }

  // ── Criar usuário (auth + profile) ────────────────────────
  async create(dto: CreateUserDto) {
    const admin = this.supabase.getAdminClient();

    // Verifica email duplicado
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', dto.email)
      .maybeSingle();

    if (existing) throw new ConflictException('Email já cadastrado');

    // Cria no Supabase Auth (trigger cria o profile automaticamente)
    const { data, error } = await admin.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,  // confirma automaticamente no PoC
      user_metadata: {
        full_name: dto.fullName,
        role: dto.role,
      },
    });

    if (error) throw new BadRequestException(error.message);

    // Atualiza campos extras no profile (phone, farm_ids)
    if (dto.phone || dto.farmIds) {
      await admin
        .from('profiles')
        .update({
          ...(dto.phone    ? { phone: dto.phone }       : {}),
          ...(dto.farmIds  ? { farm_ids: dto.farmIds }  : {}),
        })
        .eq('id', data.user.id);
    }

    return this.findOne(data.user.id);
  }

  // ── Atualizar perfil ───────────────────────────────────────
  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id); // valida existência

    const { error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .update({
        ...(dto.fullName ? { full_name: dto.fullName } : {}),
        ...(dto.role     ? { role: dto.role }          : {}),
        ...(dto.phone    ? { phone: dto.phone }        : {}),
        ...(dto.farmIds  ? { farm_ids: dto.farmIds }   : {}),
      })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return this.findOne(id);
  }

  // ── Ativar / inativar ──────────────────────────────────────
  async setActive(id: string, active: boolean) {
    await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .update({ active })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { id, active, message: active ? 'Usuário ativado' : 'Usuário inativado' };
  }

  // ── Reset de senha (gera link magic) ──────────────────────
  async resetPassword(id: string) {
    const user = await this.findOne(id);

    const { data, error } = await this.supabase
      .getAdminClient()
      .auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
      });

    if (error) throw new BadRequestException(error.message);
    return { message: 'Link de recuperação gerado', link: data.properties?.action_link };
  }

  // ── Remover usuário ────────────────────────────────────────
  async remove(id: string) {
    await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .auth.admin.deleteUser(id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Usuário removido com sucesso' };
  }
}
