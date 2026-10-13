import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { NotificationEvents } from './notification-events';
import { NotificationListeners } from './notification-listeners';
import { NotificationRulesController } from './rules.controller';
import { NotificationRules } from './rules.service';

/** Sub-project 6: notifications. Reaches scheduling and tasks only through DomainEvents, their scope services and the DB. */
@Module({
  imports: [SchedulingModule],
  controllers: [NotificationRulesController],
  providers: [NotificationEvents, NotificationListeners, NotificationRules],
  exports: [NotificationEvents, NotificationRules],
})
export class NotificationsModule {}
