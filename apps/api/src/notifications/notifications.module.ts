import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { NotificationEvents } from './notification-events';
import { NotificationListeners } from './notification-listeners';

/** Sub-project 6: notifications. Reaches scheduling and tasks only through DomainEvents, their scope services and the DB. */
@Module({
  imports: [SchedulingModule],
  providers: [NotificationEvents, NotificationListeners],
  exports: [NotificationEvents],
})
export class NotificationsModule {}
