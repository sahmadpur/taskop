import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { MediaService } from './media.service';

/** Sub-project 4: execution, evidence and problems. Depends on scheduling, never the other way round. */
@Module({
  imports: [SchedulingModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionLookups, MediaService],
})
export class ExecutionsModule {}
