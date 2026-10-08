import { Injectable } from '@nestjs/common';
import type { SiteTypeDto } from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { siteTypes } from '../db/schema';
import type { CreateSiteTypeDto, UpdateSiteTypeDto } from './dto';

const toDto = (r: typeof siteTypes.$inferSelect): SiteTypeDto => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, active: r.active });

@Injectable()
export class SiteTypesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SiteTypeDto[]> {
    const rows = await this.db.tx().select().from(siteTypes).orderBy(asc(siteTypes.sortOrder), asc(siteTypes.name));
    return rows.map(toDto);
  }

  async create(input: CreateSiteTypeDto): Promise<SiteTypeDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db.tx().insert(siteTypes).values({ tenantId, name: input.name, sortOrder: input.sortOrder }).returning();
    const dto = toDto(row!);
    await this.audit.record({ action: 'site_type.created', entityType: 'site_type', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateSiteTypeDto): Promise<SiteTypeDto> {
    const tx = this.db.tx();
    const [existing] = await tx.select().from(siteTypes).where(eq(siteTypes.id, id));
    if (!existing) throw new AppError('NOT_FOUND');
    const [row] = await tx
      .update(siteTypes)
      .set({ name: input.name, sortOrder: input.sortOrder, active: input.active })
      .where(eq(siteTypes.id, id))
      .returning();
    const dto = toDto(row!);
    await this.audit.record({ action: 'site_type.updated', entityType: 'site_type', entityId: id, before: toDto(existing), after: dto });
    return dto;
  }
}
