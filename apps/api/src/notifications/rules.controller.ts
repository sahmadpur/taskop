import { Body, Controller, Delete, Get, Inject, Injectable, Param, type PipeTransform, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type NotificationRuleDto, type RuleType, ruleTypeSchema } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { RequirePermission } from '../common/decorators';
import { NotificationRuleResponse, UpdateNotificationRuleDto } from './dto';
import { NotificationRules } from './rules.service';

/** `manual` and unknown names are not rules: 404, like an unknown id. */
@Injectable()
export class ParseRuleTypePipe implements PipeTransform<string, RuleType> {
  transform(value: string): RuleType {
    const parsed = ruleTypeSchema.safeParse(value);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return parsed.data;
  }
}

/** Spec §6.4 "Rules". */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notification-rules')
@RequirePermission('notifications.manage')
export class NotificationRulesController {
  constructor(@Inject(NotificationRules) private readonly rules: NotificationRules) {}

  @Get()
  @ApiOkResponse({ type: [NotificationRuleResponse] })
  list(): Promise<NotificationRuleDto[]> {
    return this.rules.list();
  }

  @Put(':type')
  @ApiOkResponse({ type: NotificationRuleResponse })
  update(@Param('type', ParseRuleTypePipe) type: RuleType, @Body() body: UpdateNotificationRuleDto): Promise<NotificationRuleDto> {
    return this.rules.update(type, body);
  }

  @Delete(':type')
  @ApiOkResponse({ type: NotificationRuleResponse })
  reset(@Param('type', ParseRuleTypePipe) type: RuleType): Promise<NotificationRuleDto> {
    return this.rules.reset(type);
  }
}
