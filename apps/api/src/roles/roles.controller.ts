import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PermissionCatalog, RoleDto } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { CreateRoleDto, PermissionCatalogResponse, RoleResponse, SetRolePermissionsDto, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('roles.view')
  @ApiOkResponse({ type: PermissionCatalogResponse })
  catalog(): PermissionCatalog {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermission('roles.view')
  @ApiOkResponse({ type: [RoleResponse] })
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateRoleDto): Promise<RoleDto> {
    return this.roles.create(p, body);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateRoleDto): Promise<RoleDto> {
    return this.roles.update(id, body);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('roles.manage')
  setPermissions(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetRolePermissionsDto): Promise<RoleDto> {
    return this.roles.setPermissions(p, id, body);
  }
}
