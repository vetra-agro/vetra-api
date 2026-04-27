import { Controller, Post, Body, Get, UseGuards, Req, Param, Delete, Patch } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { SignInDto } from "./dto/sign-in.dto";
import { SignUpDto } from "./dto/sign-up.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sign-up")
  @Public()
  @ApiOperation({ summary: "Criar nova conta" })
  signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  @Post("sign-in")
  @Public()
  @ApiOperation({ summary: "Entrar com email e senha" })
  signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto);
  }

  @Post("sign-out")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Encerrar sessão" })
  signOut(@Req() req: any) {
    return this.authService.signOut(req.user.accessToken, req.user);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Dados do usuário logado" })
  me(@Req() req: any) {
    return req.user;
  }

  // ── Tenants disponíveis para o usuário logado ─────────────────────────────
  @Get("tenants")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Tenants disponíveis para o usuário" })
  getTenants(@Req() req: any) {
    return this.authService.getTenantsForUser(req.user?.id);
  }

  // ── Vincular usuário a tenant (usado pelo admin) ──────────────────────────
  @Post("tenants/:tenantId/link/:userId")
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Vincular usuário a tenant" })
  linkUser(
    @Param("tenantId") tenantId: string,
    @Param("userId")   userId:   string,
    @Body() body: { role?: string; isDefault?: boolean },
    @Req() req: any,
  ) {
    return this.authService.linkUserToTenant(
      userId, tenantId,
      body.role ?? "viewer",
      body.isDefault ?? false,
      req.user?.id,
    );
  }

  // ── Desvincular usuário de tenant ─────────────────────────────────────────
  @Delete("tenants/:tenantId/link/:userId")
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Desvincular usuário de tenant" })
  unlinkUser(
    @Param("tenantId") tenantId: string,
    @Param("userId")   userId:   string,
    @Req() req: any,
  ) {
    return this.authService.unlinkUserFromTenant(userId, tenantId, req.user?.id);
  }

  // ── Definir tenant padrão ─────────────────────────────────────────────────
  @Patch("tenants/:tenantId/default")
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Definir tenant padrão do usuário logado" })
  setDefault(@Param("tenantId") tenantId: string, @Req() req: any) {
    return this.authService.setDefaultTenant(req.user?.id, tenantId, req.user?.id);
  }
}
