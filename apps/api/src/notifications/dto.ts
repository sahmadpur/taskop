import {
  messageDetailSchema,
  messageListQuerySchema,
  messagePreviewSchema,
  messageSummarySchema,
  messageTargetOptionsQuerySchema,
  messageTargetOptionsSchema,
  notificationItemSchema,
  notificationListQuerySchema,
  notificationRuleDtoSchema,
  pageOf,
  preferencesSchema,
  registerPushDeviceSchema,
  sendMessageSchema,
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
export class SendMessageDto extends createZodDto(sendMessageSchema) {}
export class MessageListQueryDto extends createZodDto(messageListQuerySchema) {}
export class MessageTargetOptionsQueryDto extends createZodDto(messageTargetOptionsQuerySchema) {}
export class MessagePreviewResponse extends createZodDto(messagePreviewSchema) {}
export class MessageSummaryResponse extends createZodDto(messageSummarySchema) {}
export class MessagePageResponse extends createZodDto(pageOf(messageSummarySchema)) {}
export class MessageDetailResponse extends createZodDto(messageDetailSchema) {}
export class MessageTargetOptionsResponse extends createZodDto(messageTargetOptionsSchema) {}
