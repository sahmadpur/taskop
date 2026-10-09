import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MediaConfirmResult, MediaUrl } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { MediaConfirmResultResponse, MediaUrlResponse } from './dto';
import { MediaService } from './media.service';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

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
