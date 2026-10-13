import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TaskAssignees } from './task-assignees';
import { TaskMediaController } from './task-media.controller';
import { TaskMediaService } from './task-media.service';
import { TaskJobs } from './task-jobs';
import { TaskListeners } from './task-listeners';
import { TaskProblems } from './task-problems';
import { TaskQueries } from './task-queries';
import { TaskScope } from './task-scope';
import { TaskSync } from './task-sync';
import { TaskWorkService } from './task-work.service';
import { TaskWriter } from './task-writer';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Sub-project 5: tasks. Depends on scheduling (jobs, site scope); reads problems through executions/problem-rows. */
@Module({
  imports: [SchedulingModule],
  controllers: [TasksController, TaskMediaController],
  providers: [TasksService, TaskQueries, TaskScope, TaskAssignees, TaskProblems, TaskWriter, TaskWorkService, TaskMediaService, TaskJobs, TaskListeners, TaskSync],
  exports: [TaskSync],
})
export class TasksModule {}
