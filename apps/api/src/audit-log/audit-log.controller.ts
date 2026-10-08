import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuditEntryDto, Page } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { AuditLogService } from './audit-log.service';
import { AuditListQueryDto, AuditPageResponse } from './dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission('audit.view')
  @ApiOkResponse({ type: AuditPageResponse })
  list(@Query() q: AuditListQueryDto): Promise<Page<AuditEntryDto>> {
    return this.auditLog.list(q);
  }
}
