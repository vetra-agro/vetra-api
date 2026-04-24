import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MenusService } from './menus.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('menus')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/menus')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo completo de módulos e itens' })
  getModules() { return this.menusService.getModules(); }

  @Get('acl')
  @ApiOperation({ summary: 'ACL completa — todos módulos e itens com acesso por perfil' })
  getFullAcl() { return this.menusService.getFullAcl(); }

  @Get('role/:role')
  @ApiOperation({ summary: 'Menu resolvido para um perfil específico' })
  getMenuForRole(@Param('role') role: string) {
    return this.menusService.getMenuForRole(role as any);
  }

  @Patch('modules/:id/toggle')
  @ApiOperation({ summary: 'Ativar/desativar módulo (licença)' })
  toggleModule(@Param('id') id: string, @Body('active') active: boolean) {
    return this.menusService.toggleModule(id, active);
  }

  @Patch('modules/:id/acl')
  @ApiOperation({ summary: 'Atualizar ACL do módulo por perfil' })
  updateModuleAcl(@Param('id') id: string, @Body() acl: Record<string, boolean>) {
    return this.menusService.updateModuleAcl(id, acl);
  }

  @Patch('items/:id/toggle')
  @ApiOperation({ summary: 'Ativar/desativar item de menu' })
  toggleItem(@Param('id') id: string, @Body('active') active: boolean) {
    return this.menusService.toggleItem(id, active);
  }

  @Patch('items/:id/acl')
  @ApiOperation({ summary: 'Atualizar ACL do item por perfil' })
  updateItemAcl(@Param('id') id: string, @Body() acl: Record<string, boolean>) {
    return this.menusService.updateItemAcl(id, acl);
  }
}
