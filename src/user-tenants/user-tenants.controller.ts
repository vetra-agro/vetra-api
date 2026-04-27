import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { UserTenantsService } from "./user-tenants.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("user-tenants")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/user-tenants")
export class UserTenantsController {
  constructor(private readonly svc: UserTenantsService) {}

  @Get("by-tenant/:tenantId")
  @ApiOperation({ summary: "Listar usuários vinculados a um tenant" })
  getUsersByTenant(@Param("tenantId") tenantId: string) {
    return this.svc.getUsersByTenant(tenantId);
  }

  @Get("by-user/:userId")
  @ApiOperation({ summary: "Listar tenants de um usuário" })
  getTenantsByUser(@Param("userId") userId: string) {
    return this.svc.getTenantsByUser(userId);
  }

  @Get("available-users/:tenantId")
  @ApiOperation({ summary: "Usuários disponíveis para vincular ao tenant" })
  getAvailableUsers(@Param("tenantId") tenantId: string) {
    return this.svc.getAvailableUsers(tenantId);
  }

  @Post("link")
  @ApiOperation({ summary: "Vincular usuário a um tenant" })
  linkUser(@Body() dto: {
    tenantId: string; userId: string;
    role: string; isDefault?: boolean;
  }, @Req() req: any) {
    return this.svc.linkUser({ ...dto, invitedBy: req.user?.id });
  }

  @Delete(":tenantId/:userId")
  @ApiOperation({ summary: "Desvincular usuário do tenant" })
  unlinkUser(
    @Param("tenantId") tenantId: string,
    @Param("userId")   userId: string,
  ) { return this.svc.unlinkUser(tenantId, userId); }

  @Patch(":tenantId/:userId/role")
  @ApiOperation({ summary: "Atualizar perfil do usuário no tenant" })
  updateRole(
    @Param("tenantId") tenantId: string,
    @Param("userId")   userId: string,
    @Body("role")      role: string,
  ) { return this.svc.updateRole(tenantId, userId, role); }

  @Patch(":userId/default/:tenantId")
  @ApiOperation({ summary: "Definir tenant padrão do usuário" })
  setDefault(
    @Param("userId")   userId: string,
    @Param("tenantId") tenantId: string,
  ) { return this.svc.setDefault(userId, tenantId); }

  @Post("seed/:tenantId")
  @ApiOperation({ summary: "Vincular todos os usuários existentes ao tenant (seed)" })
  seedLinkAll(@Param("tenantId") tenantId: string, @Req() req: any) {
    return this.svc.seedLinkAllToTenant(tenantId, req.user?.id);
  }
}
