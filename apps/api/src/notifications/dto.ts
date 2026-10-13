import { notificationRuleDtoSchema, updateNotificationRuleSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateNotificationRuleDto extends createZodDto(updateNotificationRuleSchema) {}
export class NotificationRuleResponse extends createZodDto(notificationRuleDtoSchema) {}
