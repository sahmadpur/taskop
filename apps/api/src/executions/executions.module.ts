import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TasksModule } from '../tasks/tasks.module';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionQueries } from './execution-queries';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { MediaController } from './media.controller';
import { MediaJobs } from './media-jobs';
import { MediaService } from './media.service';
import { ProblemWriter } from './problem-writer';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** Sub-project 4: execution, evidence and problems. Depends on scheduling, never the other way round. */
@Module({
  imports: [SchedulingModule, TasksModule, NotificationsModule],
  controllers: [ExecutionsController, MediaController, ProblemsController, SyncController],
  providers: [ExecutionsService, ExecutionQueries, ExecutionAccess, ExecutionLookups, MediaJobs, MediaService, ProblemWriter, ProblemsService, SyncService],
})
export class ExecutionsModule {}
