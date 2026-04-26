import {
  Injectable,
  NotFoundException,
  Optional,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  private formatAuthError(error: unknown) {
    if (!error || typeof error !== 'object') {
      return { raw: String(error) };
    }

    const maybeError = error as {
      message?: string;
      code?: string;
      status?: number;
      name?: string;
      cause?: unknown;
    };

    return {
      name: maybeError.name,
      message: maybeError.message,
      code: maybeError.code,
      status: maybeError.status,
      cause:
        maybeError.cause && typeof maybeError.cause === 'object'
          ? maybeError.cause
          : undefined,
    };
  }

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

  private isDatabaseCreateUserError(errorMessage: string): boolean {
    return errorMessage.toLowerCase().includes('database error creating new user');
  }

  private async getCreatorTenantId(
    creatorUserId?: string,
  ): Promise<string | undefined> {
    if (!creatorUserId) return undefined;

    try {
      const { data } = await this.supabase
        .getAdminClient()
        .from('profiles')
        .select('*')
        .eq('id', creatorUserId)
        .maybeSingle();

      return (data as any)?.tenant_id ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async createAuthUserWithFallback(
    admin: ReturnType<SupabaseProvider['getAdminClient']>,
    dto: CreateUserDto,
    normalizedEmail: string,
    tenantId?: string,
  ) {
    const basePayload = {
      email: normalizedEmail,
      password: dto.password,
      email_confirm: true,
    };

    const firstAttempt = await admin.auth.admin.createUser({
      ...basePayload,
      user_metadata: {
        full_name: dto.fullName,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
    });

    if (!firstAttempt.error) return firstAttempt;

    this.logger.error('createUser first attempt failed', {
      email: normalizedEmail,
      withTenant: Boolean(tenantId),
      details: this.formatAuthError(firstAttempt.error),
    });

    if (!this.isDatabaseCreateUserError(firstAttempt.error.message)) {
      this.mapCreateUserError(firstAttempt.error.message);
    }

    const retryAttempt = await admin.auth.admin.createUser({
      ...basePayload,
      user_metadata: tenantId ? { tenant_id: tenantId } : undefined,
    });

    if (retryAttempt.error) {
      this.logger.error('createUser retry attempt failed', {
        email: normalizedEmail,
        withTenant: Boolean(tenantId),
        details: this.formatAuthError(retryAttempt.error),
      });

      if (this.isDatabaseCreateUserError(retryAttempt.error.message)) {
        const existingAuthUser = await this.findAuthUserByEmail(
          admin,
          normalizedEmail,
        );

        if (existingAuthUser) {
          this.logger.warn('Recovered existing auth user after createUser failure', {
            email: normalizedEmail,
            userId: existingAuthUser.id,
          });

          return {
            data: { user: existingAuthUser },
            error: null,
          };
        }
      }

      this.mapCreateUserError(retryAttempt.error.message);
    }

    return retryAttempt;
  }

  private async findAuthUserByEmail(
    admin: ReturnType<SupabaseProvider['getAdminClient']>,
    email: string,
  ) {
    if (typeof admin.auth?.admin?.listUsers !== 'function') return null;

    const normalized = email.trim().toLowerCase();
    let page = 1;
    const perPage = 200;

    while (page <= 10) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });

      if (error) {
        this.logger.error('listUsers failed while recovering auth user', {
          email: normalized,
          details: this.formatAuthError(error),
        });
        return null;
      }

      const users = data?.users ?? [];
      const found = users.find(
        (user) => user.email?.trim().toLowerCase() === normalized,
      );

      if (found) return found;
      if (users.length < perPage) break;
      page += 1;
    }

    return null;
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

  async findAll(filters?: { role?: string; active?: boolean; search?: string }) {
    let query = this.supabase
      .getAdminClient()
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.role) query = query.eq('role', filters.role);
    if (filters?.active != null) query = query.eq('active', filters.active);
    if (filters?.search) {
      query = query.or(
        `full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

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

  async create(dto: CreateUserDto, creatorUserId?: string) {
    const admin = this.supabase.getAdminClient();
    const normalizedEmail = dto.email.trim().toLowerCase();
    const creatorTenantId = await this.getCreatorTenantId(creatorUserId);

    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) throw new ConflictException('Email já cadastrado');

    const existingAuthUser = await this.findAuthUserByEmail(admin, normalizedEmail);

    const userId = existingAuthUser
      ? existingAuthUser.id
      : (
          await this.createAuthUserWithFallback(
            admin,
            dto,
            normalizedEmail,
            creatorTenantId,
          )
        ).data.user?.id;

    if (!userId)
      throw new BadRequestException(
        'Falha ao criar usuário no provedor de autenticação',
      );

    const profile = await this.waitForProfile(userId);
    if (!profile) {
      const { error: upsertError } = await admin.from('profiles').upsert(
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

    const { error: profileUpdateError } = await admin
      .from('profiles')
      .update({
        full_name: dto.fullName,
        role: dto.role,
        ...(dto.phone ? { phone: dto.phone } : {}),
      })
      .eq('id', userId);

    if (profileUpdateError)
      throw new BadRequestException(profileUpdateError.message);

    const createdUser = await this.findOne(userId);

    await this.audit?.log({
      userId,
      userEmail: normalizedEmail,
      userName: dto.fullName,
      userRole: dto.role,
      eventType: 'record_created',
      module: 'users',
      entity: 'profile',
      entityId: userId,
      entityLabel: dto.fullName,
      description: 'Usuário criado',
      success: true,
    });

    return createdUser;
  }

  async update(id: string, dto: UpdateUserDto) {
    const previous = await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .update({
        ...(dto.fullName ? { full_name: dto.fullName } : {}),
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.phone ? { phone: dto.phone } : {}),
      })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);

    const updated = await this.findOne(id);

    await this.audit?.log({
      userId: id,
      userEmail: updated.email,
      userName: updated.full_name,
      userRole: updated.role,
      eventType: 'record_updated',
      module: 'users',
      entity: 'profile',
      entityId: id,
      entityLabel: updated.full_name,
      description: 'Dados do usuário atualizados',
      oldValues: {
        fullName: previous.full_name,
        role: previous.role,
        phone: previous.phone,
      },
      newValues: {
        fullName: updated.full_name,
        role: updated.role,
        phone: updated.phone,
      },
      success: true,
    });

    return updated;
  }

  async setActive(id: string, active: boolean) {
    const user = await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .from('profiles')
      .update({ active })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);

    await this.audit?.log({
      userId: id,
      userEmail: user.email,
      userName: user.full_name,
      userRole: user.role,
      eventType: 'record_updated',
      module: 'users',
      entity: 'profile',
      entityId: id,
      entityLabel: user.full_name,
      description: active ? 'Usuário ativado' : 'Usuário inativado',
      newValues: { active },
      success: true,
    });

    return {
      id,
      active,
      message: active ? 'Usuário ativado' : 'Usuário inativado',
    };
  }

  async resetPassword(id: string) {
    const user = await this.findOne(id);

    const { data, error } = await this.supabase
      .getAdminClient()
      .auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
      });

    if (error) throw new BadRequestException(error.message);

    await this.audit?.log({
      userId: id,
      userEmail: user.email,
      userName: user.full_name,
      userRole: user.role,
      eventType: 'password_reset',
      module: 'users',
      entity: 'profile',
      entityId: id,
      entityLabel: user.full_name,
      description: 'Link de recuperação de senha gerado',
      success: true,
    });

    return {
      message: 'Link de recuperação gerado',
      link: data.properties?.action_link,
    };
  }

  async changePassword(id: string, newPassword: string) {
    const user = await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .auth.admin.updateUserById(id, { password: newPassword });

    if (error) throw new BadRequestException(error.message);

    await this.audit?.log({
      userId: id,
      userEmail: user.email,
      userName: user.full_name,
      userRole: user.role,
      eventType: 'password_reset',
      module: 'users',
      entity: 'profile',
      entityId: id,
      entityLabel: user.full_name,
      description: 'Senha alterada diretamente por administrador',
      success: true,
    });

    return { message: 'Senha alterada com sucesso' };
  }

  async remove(id: string) {
    const user = await this.findOne(id);

    const { error } = await this.supabase
      .getAdminClient()
      .auth.admin.deleteUser(id);

    if (error) throw new BadRequestException(error.message);

    await this.audit?.log({
      userId: id,
      userEmail: user.email,
      userName: user.full_name,
      userRole: user.role,
      eventType: 'record_deleted',
      module: 'users',
      entity: 'profile',
      entityId: id,
      entityLabel: user.full_name,
      description: 'Usuário removido',
      success: true,
    });

    return { message: 'Usuário removido com sucesso' };
  }
}
