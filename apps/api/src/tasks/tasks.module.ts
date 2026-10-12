import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TaskAssignees } from './task-assignees';
import { TaskProblems } from './task-problems';
import { TaskQueries } from './task-queries';
import { TaskScope } from './task-scope';
import { TaskWriter } from './task-writer';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Sub-project 5: tasks. Depends on scheduling (jobs, site scope); reads problems through executions/problem-rows. */
@Module({
  imports: [SchedulingModule],
  controllers: [TasksController],
  providers: [TasksService, TaskQueries, TaskScope, TaskAssignees, TaskProblems, TaskWriter],
})
export class TasksModule {}
