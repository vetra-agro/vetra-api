import { Injectable, UnauthorizedException, ConflictException, Optional } from "@nestjs/common";
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
      const { data: license } = await this.supabase
        .getAdminClient()
        .from("tenant_license_status")
        .select("tenant_id, tenant_name, plan")
        .in("status", ["active", "trial"])
        .limit(1)
        .single();

      if (license) {
        tenantId   = license.tenant_id;
        tenantName = license.tenant_name;
        tenantPlan = license.plan;
      }
    } catch {
      // Nenhum tenant ainda — OK para PoC
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

  // ── Tenants disponíveis para o usuário ───────────────────────────────────
  // No PoC: retorna todos os tenants ativos
  // Em produção: filtrar por uma tabela user_tenants com FK userId+tenantId
  async getTenantsForUser(_userId: string) {
    const { data, error } = await this.supabase
      .getAdminClient()
      .from("tenant_license_status")
      .select("tenant_id, tenant_name, plan, status, modules")
      .in("status", ["active", "trial"])
      .order("tenant_name");

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
