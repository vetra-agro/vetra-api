import { Injectable, UnauthorizedException, ConflictException, Optional, NotFoundException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { SignInDto } from "./dto/sign-in.dto";
import { SignUpDto } from "./dto/sign-up.dto";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class AuthService {
  constructor(
    private supabase: SupabaseProvider,
    @Optional() private audit?: AuditService,
  ) {}

  async signUp(dto: SignUpDto) {
    const { data, error } = await this.supabase.getClient().auth.signUp({
      email: dto.email,
      password: dto.password,
      options: { data: { full_name: dto.fullName, role: "producer" } },
    });
    if (error) throw new ConflictException(error.message);

    await this.audit?.log({
      userId: data.user?.id,
      userEmail: data.user?.email ?? dto.email,
      userName: dto.fullName,
      userRole: "producer",
      eventType: "record_created",
      module: "auth",
      entity: "user",
      entityId: data.user?.id,
      entityLabel: dto.fullName,
      description: "Novo usuário cadastrado",
      success: true,
    });

    return { user: data.user, session: data.session };
  }

  async signIn(dto: SignInDto) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    if (error) {
      await this.audit?.log({
        userEmail: dto.email,
        eventType: "login_failed",
        module: "auth",
        entity: "session",
        description: "Tentativa de login inválida",
        success: false,
        errorMessage: error.message,
      });
      throw new UnauthorizedException("Credenciais inválidas");
    }

    // Busca o primeiro tenant ativo vinculado
    let tenantId:   string | null = null;
    let tenantName: string | null = null;
    let tenantPlan: string | null = null;

    try {
      const { data: defaultTenant } = await this.supabase
        .getAdminClient()
        .from("user_available_tenants")
        .select("tenant_id, tenant_name, plan")
        .eq("user_id", data.user.id)
        .eq("is_default", true)
        .single();

      if (defaultTenant) {
        tenantId   = defaultTenant.tenant_id;
        tenantName = defaultTenant.tenant_name;
        tenantPlan = defaultTenant.plan;
      } else {
        // Sem default definido — pega o primeiro disponível
        const { data: firstTenant } = await this.supabase
          .getAdminClient()
          .from("user_available_tenants")
          .select("tenant_id, tenant_name, plan")
          .eq("user_id", data.user.id)
          .limit(1)
          .single();

        if (firstTenant) {
          tenantId   = firstTenant.tenant_id;
          tenantName = firstTenant.tenant_name;
          tenantPlan = firstTenant.plan;
        }
      }
    } catch {
      // Nenhum tenant vinculado — OK para PoC inicial
    }

    await this.audit?.log({
      userId: data.user.id,
      userEmail: data.user.email,
      userName: data.user.user_metadata?.full_name,
      userRole: data.user.user_metadata?.role,
      tenantId: tenantId ?? undefined,
      eventType: "login_success",
      module: "auth",
      entity: "session",
      entityId: data.session.access_token,
      description: "Login realizado com sucesso",
      success: true,
    });

    return {
      accessToken:  data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn:    data.session.expires_in,
      tenantId,
      tenantName,
      tenantPlan,
      user: {
        id:       data.user.id,
        email:    data.user.email,
        fullName: data.user.user_metadata?.full_name,
        role:     data.user.user_metadata?.role,
      },
    };
  }

  async signOut(accessToken: string, user?: any) {
    const client = this.supabase.getAuthenticatedClient(accessToken);
    await client.auth.signOut();

    await this.audit?.log({
      userId: user?.id,
      userEmail: user?.email,
      userName: user?.user_metadata?.full_name,
      userRole: user?.user_metadata?.role,
      eventType: "logout",
      module: "auth",
      entity: "session",
      description: "Sessão encerrada com sucesso",
      success: true,
    });

    return { message: "Sessão encerrada com sucesso" };
  }

  async validateToken(token: string) {
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }

  // ── Tenants disponíveis para o usuário — agora via user_available_tenants
  async getTenantsForUser(userId: string) {
    const { data, error } = await this.supabase
      .getAdminClient()
      .from("user_available_tenants")
      .select("tenant_id, tenant_name, plan, license_status, modules, is_default, role")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("tenant_name");

    if (error) throw new Error(error.message);
    return (data ?? []).map((t: any) => ({
      tenant_id:   t.tenant_id,
      tenant_name: t.tenant_name,
      plan:        t.plan,
      status:      t.license_status,
      modules:     t.modules,
      is_default:  t.is_default,
      role:        t.role,
    }));
  }

  async linkUserToTenant(
    userId: string,
    tenantId: string,
    role = "viewer",
    isDefault = false,
    performedBy?: string,
  ) {
    const { data: profile } = await this.supabase
      .getAdminClient()
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) throw new NotFoundException("Usuário não encontrado");

    const { data: existing } = await this.supabase
      .getAdminClient()
      .from("user_tenants")
      .select("id, active, role, is_default")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existing?.active && existing.role === role && existing.is_default === isDefault) {
      throw new ConflictException("Usuário já vinculado a este tenant");
    }

    let result: any;
    if (existing) {
      const { data, error } = await this.supabase
        .getAdminClient()
        .from("user_tenants")
        .update({
          active: true,
          role,
          is_default: isDefault,
          invited_by: performedBy,
          accepted_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      result = data;
    } else {
      const { data, error } = await this.supabase
        .getAdminClient()
        .from("user_tenants")
        .insert({
          user_id: userId,
          tenant_id: tenantId,
          role,
          is_default: isDefault,
          invited_by: performedBy,
          accepted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      result = data;
    }

    if (isDefault) {
      const { error: rpcError } = await this.supabase
        .getAdminClient()
        .rpc("set_default_tenant", { p_user_id: userId, p_tenant_id: tenantId });
      if (rpcError) throw new Error(rpcError.message);
    }

    await this.audit?.log({
      userId: performedBy,
      eventType: "permission_changed",
      module: "auth",
      entity: "user_tenant",
      entityId: result?.id,
      entityLabel: profile.full_name,
      description: "Vínculo usuário-tenant criado/atualizado",
      metadata: { targetUserId: userId, tenantId },
      oldValues: existing ?? undefined,
      newValues: { role, isDefault, active: true },
      success: true,
    });

    return result;
  }

  async unlinkUserFromTenant(userId: string, tenantId: string, performedBy?: string) {
    const { data: existing } = await this.supabase
      .getAdminClient()
      .from("user_tenants")
      .select("id, active, role, is_default")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { error } = await this.supabase
      .getAdminClient()
      .from("user_tenants")
      .update({ active: false, is_default: false })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId: performedBy,
      eventType: "permission_changed",
      module: "auth",
      entity: "user_tenant",
      entityId: existing?.id,
      description: "Vínculo usuário-tenant desativado",
      metadata: { targetUserId: userId, tenantId },
      oldValues: existing ?? undefined,
      newValues: { active: false, is_default: false },
      success: true,
    });

    return { unlinked: true };
  }

  async setDefaultTenant(userId: string, tenantId: string, performedBy?: string) {
    const { error } = await this.supabase
      .getAdminClient()
      .rpc("set_default_tenant", { p_user_id: userId, p_tenant_id: tenantId });

    if (error) throw new Error(error.message);

    await this.audit?.log({
      userId: performedBy ?? userId,
      tenantId,
      eventType: "permission_changed",
      module: "auth",
      entity: "user_tenant",
      description: "Tenant padrão atualizado",
      metadata: { targetUserId: userId, tenantId },
      newValues: { is_default: true },
      success: true,
    });

    return { default: tenantId };
  }
}
