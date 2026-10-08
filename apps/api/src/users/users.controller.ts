import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page, UserDto, UserWithSecret } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  CreateWorkerDto,
  InviteStaffDto,
  ResetCredentialDto,
  SetUserSitesDto,
  SetUserTeamsDto,
  UpdateUserDto,
  UserListQueryDto,
  UserPageResponse,
  UserResponse,
  UserWithSecretResponse,
} from './dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  @ApiOkResponse({ type: UserPageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: UserListQueryDto): Promise<Page<UserDto>> {
    return this.users.list(p, q);
  }

  @Get(':id')
  @RequirePermission('users.view')
  @ApiOkResponse({ type: UserResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.get(p, id);
  }

  @Post('workers')
  @RequirePermission('users.manage')
  @ApiCreatedResponse({ type: UserWithSecretResponse })
  createWorker(@CurrentPrincipal() p: Principal, @Body() body: CreateWorkerDto): Promise<UserWithSecret> {
    return this.users.createWorker(p, body);
  }

  @Post('invite')
  @RequirePermission('users.manage')
  @ApiCreatedResponse({ type: UserResponse })
  invite(@CurrentPrincipal() p: Principal, @Body() body: InviteStaffDto): Promise<UserDto> {
    return this.users.inviteStaff(p, body);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateUserDto): Promise<UserDto> {
    return this.users.update(p, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  deactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.deactivate(p, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  reactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.reactivate(p, id);
  }

  @Post(':id/reset-credential')
  @HttpCode(200)
  @RequirePermission('users.manage')
  @ApiOkResponse({ type: UserWithSecretResponse })
  resetCredential(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: ResetCredentialDto): Promise<UserWithSecret> {
    return this.users.resetCredential(p, id, body);
  }

  @Put(':id/sites')
  @RequirePermission('users.manage')
  setSites(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetUserSitesDto): Promise<UserDto> {
    return this.users.setSites(p, id, body.siteIds);
  }

  @Put(':id/teams')
  @RequirePermission('users.manage')
  setTeams(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetUserTeamsDto): Promise<UserDto> {
    return this.users.setTeams(p, id, body.teamIds);
  }
}
