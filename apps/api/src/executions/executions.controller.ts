import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ClaimResult, CompleteResult, ExecutionCorrections, ExecutionDetail, MediaUploadTicket, ResubmitResult, SaveAnswersResult } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { ClaimCommandDto, ClaimResultResponse, CompleteCommandDto, CompleteResultResponse, ExecutionCorrectionsResponse, ExecutionDetailResponse, MediaUploadTicketResponse, RegisterMediaCommandDto, ResubmitCommandDto, ResubmitResultResponse, SaveAnswersCommandDto, SaveAnswersResultResponse } from './dto';
import { ExecutionQueries } from './execution-queries';
import { ExecutionsService } from './executions.service';
import { MediaService } from './media.service';
import { ReworkService } from './rework.service';

/** Upload commands from the phone (spec §6). Any authenticated tenant user; the service checks the executor. */
@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(ExecutionQueries) private readonly queries: ExecutionQueries,
    @Inject(ReworkService) private readonly rework: ReworkService,
  ) {}

  /** The executor, or assignments.view or reports.view within the data scope (spec §6.8, SP7 §5.6); anyone else gets 404. */
  @Get(':id')
  @ApiOkResponse({ type: ExecutionDetailResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<ExecutionDetail> {
    return this.queries.detail(p, id);
  }

  /** NFR-07.05: the original, the corrections, the rework rounds and the diff; for anyone who can read the run. */
  @Get(':id/corrections')
  @ApiOkResponse({ type: ExecutionCorrectionsResponse })
  corrections(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<ExecutionCorrections> {
    return this.queries.corrections(p, id);
  }

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

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: CompleteResultResponse })
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: CompleteCommandDto): Promise<CompleteResult> {
    return this.executions.complete(p, id, body);
  }

  /** SP8: the executor closes a rework round; the outbox sends it after the round's answers and media. */
  @Post(':id/resubmit')
  @HttpCode(200)
  @ApiOkResponse({ type: ResubmitResultResponse })
  resubmit(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: ResubmitCommandDto): Promise<ResubmitResult> {
    return this.rework.resubmit(p, id, body);
  }
}
