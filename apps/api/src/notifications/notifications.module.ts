import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TasksModule } from '../tasks/tasks.module';
import { InboxService } from './inbox.service';
import { MeNotificationsController } from './me-notifications.controller';
import { MessageQueries } from './message-queries';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationDelivery } from './notification-delivery';
import { NotificationEvents } from './notification-events';
import { NotificationFanout } from './notification-fanout';
import { NotificationJobs } from './notification-jobs';
import { NotificationListeners } from './notification-listeners';
import { NotificationRecipients } from './notification-recipients';
import { NotificationTargets } from './notification-targets';
import { NotificationRulesController } from './rules.controller';
import { NotificationRules } from './rules.service';
import { PUSH_SENDER, pushSenderFor } from './push-sender';
import { ScopeSubjects } from './scope-subjects';

/** Sub-project 6: notifications. Reaches scheduling and tasks only through DomainEvents, their scope services and the DB. */
@Module({
  imports: [SchedulingModule, TasksModule],
  controllers: [NotificationRulesController, MeNotificationsController, MessagesController],
  providers: [
    NotificationEvents,
    NotificationListeners,
    NotificationRules,
    ScopeSubjects,
    NotificationTargets,
    NotificationRecipients,
    NotificationFanout,
    NotificationDelivery,
    NotificationJobs,
    InboxService,
    MessagesService,
    MessageQueries,
    { provide: PUSH_SENDER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => pushSenderFor(config) },
  ],
  exports: [NotificationEvents, NotificationRules, InboxService],
})
export class NotificationsModule {}
