import { Body, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { CorrectionResult } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from '../scheduling/actor';
import { CorrectionsService } from './corrections.service';
import { CorrectAnswersDto, CorrectionResultResponse } from './dto';

/** SP8 spec §6.2: a manager's corrections and send-backs, for tenant users and platform admins (Spec decision 24). */
export function correctionsControllerFor(mode: RouteMode) {
  const correct = perm(mode, 'executions.correct');

  @controllerDecorators(mode, 'executions', 'executions')
  class CorrectionsController {
    constructor(@Inject(CorrectionsService) private readonly corrections: CorrectionsService) {}

    @Post(':id/corrections')
    @HttpCode(200)
    @correct
    @ApiOkResponse({ type: CorrectionResultResponse })
    correct(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CorrectAnswersDto): Promise<CorrectionResult> {
      return this.corrections.correct(a, id, body);
    }
  }
  return named(CorrectionsController, mode === 'tenant' ? 'CorrectionsController' : 'PlatformTenantCorrectionsController');
}

export const TenantCorrectionsController = correctionsControllerFor('tenant');
export const PlatformTenantCorrectionsController = correctionsControllerFor('platform');
