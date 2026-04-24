import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { UserRole, AclAction } from './acl.service';
import { AclService } from './acl.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('acl')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/acl')
export class AclController {
  constructor(private readonly aclService: AclService) {}

  @Get('matrix')
  @ApiOperation({ summary: 'Matriz completa: todos perfis × módulos × ações' })
  getMatrix() { return this.aclService.getMatrix(); }

  @Get('history')
  @ApiOperation({ summary: 'Histórico de alterações de permissões' })
  @ApiQuery({ name: 'role', required: false })
  getHistory(@Query('role') role?: string) {
    return this.aclService.getHistory(role as UserRole);
  }

  @Get(':role')
  @ApiOperation({ summary: 'Permissões de um perfil específico' })
  getByRole(@Param('role') role: string) {
    return this.aclService.getByRole(role as UserRole);
  }

  @Patch(':role/:module/:action')
  @ApiOperation({ summary: 'Atualizar permissão individual' })
  updatePermission(
    @Param('role')   role: string,
    @Param('module') module: string,
    @Param('action') action: string,
    @Body('allowed') allowed: boolean,
    @Req() req: any,
  ) {
    return this.aclService.updatePermission(role as UserRole, module, action as AclAction, allowed, req.user?.id);
  }

  @Post(':role/batch')
  @ApiOperation({ summary: 'Atualizar permissões em lote de um perfil' })
  updateBatch(
    @Param('role') role: string,
    @Body() body: { permissions: Array<{ moduleKey: string; action: string; allowed: boolean }> },
    @Req() req: any,
  ) {
    return this.aclService.updateRolePermissions(
      role as UserRole,
      body.permissions.map((p) => ({ ...p, action: p.action as AclAction })),
      req.user?.id,
    );
  }

  @Post(':role/copy-from/:fromRole')
  @ApiOperation({ summary: 'Copiar permissões de um perfil para outro' })
  copyRole(
    @Param('role')     role: string,
    @Param('fromRole') fromRole: string,
    @Req() req: any,
  ) {
    return this.aclService.copyRole(fromRole as UserRole, role as UserRole, req.user?.id);
  }

  @Post(':role/reset')
  @ApiOperation({ summary: 'Resetar perfil para permissões padrão' })
  resetRole(@Param('role') role: string) {
    return this.aclService.resetRole(role as UserRole);
  }
}
