import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TasksModule } from '../tasks/tasks.module';
import { NotificationEvents } from './notification-events';
import { NotificationFanout } from './notification-fanout';
import { NotificationListeners } from './notification-listeners';
import { NotificationRecipients } from './notification-recipients';
import { NotificationTargets } from './notification-targets';
import { NotificationRulesController } from './rules.controller';
import { NotificationRules } from './rules.service';
import { ScopeSubjects } from './scope-subjects';

/** Sub-project 6: notifications. Reaches scheduling and tasks only through DomainEvents, their scope services and the DB. */
@Module({
  imports: [SchedulingModule, TasksModule],
  controllers: [NotificationRulesController],
  providers: [NotificationEvents, NotificationListeners, NotificationRules, ScopeSubjects, NotificationTargets, NotificationRecipients, NotificationFanout],
  exports: [NotificationEvents, NotificationRules],
})
export class NotificationsModule {}
