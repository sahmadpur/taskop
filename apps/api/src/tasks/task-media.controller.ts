import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MediaConfirmResult, MediaUrl } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { MediaConfirmResultResponse, MediaUrlResponse } from '../executions/dto';
import { TaskMediaService } from './task-media.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('task-media')
export class TaskMediaController {
  constructor(@Inject(TaskMediaService) private readonly media: TaskMediaService) {}

  @Post(':id/uploaded')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaConfirmResultResponse })
  confirm(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MediaConfirmResult> {
    return this.media.confirmUploaded(p, id);
  }

  @Get(':id/url')
  @ApiOkResponse({ type: MediaUrlResponse })
  url(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MediaUrl> {
    return this.media.viewUrl(p, id);
  }
}
