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

  private mapCreateUserError(errorMessage: string): never {
    const message = errorMessage.toLowerCase();
    if (
      message.includes('already been registered') ||
      message.includes('already registered') ||
      message.includes('duplicate')
    ) {
      throw new ConflictException('Email já cadastrado');
    }
    throw new BadRequestException(errorMessage);
  }

  private async findProfileById(id: string) {
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async waitForProfile(id: string, attempts = 5, delayMs = 150) {
    for (let i = 0; i < attempts; i++) {
      const profile = await this.findProfileById(id);
      if (profile) return profile;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }

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
    const normalizedEmail = dto.email.trim().toLowerCase();

    // Verifica email duplicado
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) throw new ConflictException('Email já cadastrado');

    // Cria no Supabase Auth (trigger cria o profile automaticamente)
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: dto.password,
      email_confirm: true,  // confirma automaticamente no PoC
      user_metadata: {
        full_name: dto.fullName,
        role: dto.role,
      },
    });

    if (error) this.mapCreateUserError(error.message);

    if (!data.user?.id) {
      throw new BadRequestException('Falha ao criar usuário no provedor de autenticação');
    }

    const userId = data.user.id;

    // Garante profile mesmo quando o trigger ainda não executou a tempo.
    const profile = await this.waitForProfile(userId);
    if (!profile) {
      const { error: upsertError } = await admin
        .from('profiles')
        .upsert(
          {
            id: userId,
            email: normalizedEmail,
            full_name: dto.fullName,
            role: dto.role,
          },
          { onConflict: 'id' },
        );

      if (upsertError) throw new BadRequestException(upsertError.message);
    }

    // Atualiza campos extras no profile
    if (dto.phone) {
      const { error: profileUpdateError } = await admin
        .from('profiles')
        .update({
          phone: dto.phone,
        })
        .eq('id', userId);

      if (profileUpdateError) throw new BadRequestException(profileUpdateError.message);
    }

    return this.findOne(userId);
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

  // ── Alterar senha diretamente ──────────────────────────────
  async changePassword(id: string, newPassword: string) {
    await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .auth.admin.updateUserById(id, { password: newPassword });

    if (error) throw new BadRequestException(error.message);
    return { message: 'Senha alterada com sucesso' };
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
