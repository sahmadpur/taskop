import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { DomainEvents } from './domain-events';
import { ScopeService } from './scope.service';

@Global()
@Module({
  providers: [ScopeService, DomainEvents, { provide: Clock, useClass: SystemClock }],
  exports: [ScopeService, DomainEvents, Clock],
})
export class CommonModule {}
