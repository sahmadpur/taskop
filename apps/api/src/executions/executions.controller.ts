import { Body, Controller, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ClaimResult, MediaUploadTicket, SaveAnswersResult } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { ClaimCommandDto, ClaimResultResponse, MediaUploadTicketResponse, RegisterMediaCommandDto, SaveAnswersCommandDto, SaveAnswersResultResponse } from './dto';
import { ExecutionsService } from './executions.service';
import { MediaService } from './media.service';

/** Upload commands from the phone (spec §6). Any authenticated tenant user; the service checks the executor. */
@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** A rejected claim is a normal 200 so the outbox moves on (spec §6.2). */
  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: ClaimResultResponse })
  claim(@CurrentPrincipal() p: Principal, @Body() body: ClaimCommandDto): Promise<ClaimResult> {
    return this.executions.claim(p, body);
  }

  @Post(':id/media')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaUploadTicketResponse })
  registerMedia(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: RegisterMediaCommandDto): Promise<MediaUploadTicket> {
    return this.media.register(p, id, body);
  }

  @Put(':id/answers')
  @ApiOkResponse({ type: SaveAnswersResultResponse })
  saveAnswers(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SaveAnswersCommandDto): Promise<SaveAnswersResult> {
    return this.executions.saveAnswers(p, id, body);
  }
}
