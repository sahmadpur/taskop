import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MessageDetail, MessagePreview, MessageSummary, MessageTargetOptions, Page } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  MessageDetailResponse,
  MessageListQueryDto,
  MessagePageResponse,
  MessagePreviewResponse,
  MessageSummaryResponse,
  MessageTargetOptionsQueryDto,
  MessageTargetOptionsResponse,
  SendMessageDto,
} from './dto';
import { MessageQueries } from './message-queries';
import { MessagesService } from './messages.service';

/** Spec §6.4 "Manual messages" (notifications.send). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/messages')
@RequirePermission('notifications.send')
export class MessagesController {
  constructor(
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(MessageQueries) private readonly queries: MessageQueries,
  ) {}

  /** Declared before `:id`, so "options" is never parsed as an id. */
  @Get('options')
  @ApiOkResponse({ type: MessageTargetOptionsResponse })
  options(@CurrentPrincipal() p: Principal, @Query() q: MessageTargetOptionsQueryDto): Promise<MessageTargetOptions> {
    return this.messages.options(p, q.q);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOkResponse({ type: MessagePreviewResponse })
  preview(@CurrentPrincipal() p: Principal, @Body() body: SendMessageDto): Promise<MessagePreview> {
    return this.messages.preview(p, body);
  }

  @Post()
  @ApiCreatedResponse({ type: MessageSummaryResponse })
  send(@CurrentPrincipal() p: Principal, @Body() body: SendMessageDto): Promise<MessageSummary> {
    return this.messages.send(p, body);
  }

  @Get()
  @ApiOkResponse({ type: MessagePageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: MessageListQueryDto): Promise<Page<MessageSummary>> {
    return this.queries.list(p, q);
  }

  @Get(':id')
  @ApiOkResponse({ type: MessageDetailResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MessageDetail> {
    return this.queries.detail(p, id);
  }
}
