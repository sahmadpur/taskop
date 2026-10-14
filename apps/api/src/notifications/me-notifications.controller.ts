import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { NotificationItem, Page, Preferences, UnreadCount } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  NotificationListQueryDto,
  NotificationPageResponse,
  PreferencesResponse,
  RegisterPushDeviceDto,
  UnreadCountResponse,
  UpdatePreferencesDto,
} from './dto';
import { InboxService } from './inbox.service';

/** Spec §6.4 "Current user": any signed-in user, own rows only. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me')
export class MeNotificationsController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get('notifications')
  @ApiOkResponse({ type: NotificationPageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: NotificationListQueryDto): Promise<Page<NotificationItem>> {
    return this.inbox.list(p, q);
  }

  @Get('notifications/unread-count')
  @ApiOkResponse({ type: UnreadCountResponse })
  async unreadCount(@CurrentPrincipal() p: Principal): Promise<UnreadCount> {
    return { count: await this.inbox.unreadCount(p.userId) };
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  markAllRead(@CurrentPrincipal() p: Principal): Promise<void> {
    return this.inbox.markAllRead(p.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  markRead(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<void> {
    return this.inbox.markRead(p.userId, id);
  }

  @Put('push-devices')
  @HttpCode(204)
  registerDevice(@CurrentPrincipal() p: Principal, @Body() body: RegisterPushDeviceDto): Promise<void> {
    return this.inbox.registerDevice(p, body);
  }

  @Delete('push-devices/:token')
  @HttpCode(204)
  removeDevice(@CurrentPrincipal() p: Principal, @Param('token') token: string): Promise<void> {
    return this.inbox.removeDevice(p, token);
  }

  @Patch('preferences')
  @ApiOkResponse({ type: PreferencesResponse })
  updatePreferences(@CurrentPrincipal() p: Principal, @Body() body: UpdatePreferencesDto): Promise<Preferences> {
    return this.inbox.updatePreferences(p, body);
  }
}
