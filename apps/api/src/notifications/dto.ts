import {
  notificationItemSchema,
  notificationListQuerySchema,
  notificationRuleDtoSchema,
  pageOf,
  preferencesSchema,
  registerPushDeviceSchema,
  unreadCountSchema,
  updateNotificationRuleSchema,
  updatePreferencesSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateNotificationRuleDto extends createZodDto(updateNotificationRuleSchema) {}
export class NotificationRuleResponse extends createZodDto(notificationRuleDtoSchema) {}
export class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}
export class NotificationPageResponse extends createZodDto(pageOf(notificationItemSchema)) {}
export class UnreadCountResponse extends createZodDto(unreadCountSchema) {}
export class RegisterPushDeviceDto extends createZodDto(registerPushDeviceSchema) {}
export class UpdatePreferencesDto extends createZodDto(updatePreferencesSchema) {}
export class PreferencesResponse extends createZodDto(preferencesSchema) {}
