import { Injectable } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ContentSaveResult,
  countItems,
  type GlobalTemplateDto,
  type GlobalTemplateSummary,
  validateForPublish,
} from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { globalTemplates } from '../db/schema';
import { parseDraftOrThrow, storedContent } from './content';
import type { CreateTemplateDto, SaveContentDto, UpdateGlobalTemplateDto } from './dto';

type Row = typeof globalTemplates.$inferSelect;

const summary = (r: Row): GlobalTemplateSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  category: r.category,
  published: r.published,
  sortOrder: r.sortOrder,
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const dto = (r: Row): GlobalTemplateDto => ({ ...summary(r), revision: r.revision, content: storedContent(r.content) });
const meta = (r: Row) => ({ name: r.name, description: r.description, category: r.category, sortOrder: r.sortOrder });

/** Taskop's global library, on the platform connection (no tenant, no RLS). Audited as platform scope. */
@Injectable()
export class GlobalTemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<GlobalTemplateSummary[]> {
    const rows = await this.db.platform.select().from(globalTemplates).orderBy(asc(globalTemplates.sortOrder), asc(globalTemplates.name));
    return rows.map(summary);
  }

  async get(id: string): Promise<GlobalTemplateDto> {
    const [r] = await this.db.platform.select().from(globalTemplates).where(eq(globalTemplates.id, id));
    if (!r) throw new AppError('NOT_FOUND');
    return dto(r);
  }

  async create(adminId: string, input: CreateTemplateDto): Promise<GlobalTemplateDto> {
    const content: ChecklistContent = input.content === undefined ? blankContent() : parseDraftOrThrow(input.content);
    return this.db.platform.transaction(async (tx) => {
      const [r] = await tx
        .insert(globalTemplates)
        .values({
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          content,
          itemCount: countItems(content),
          createdByPlatformAdminId: adminId,
        })
        .returning();
      await this.log(tx, adminId, 'global_template.created', r!.id, undefined, meta(r!));
      return dto(r!);
    });
  }

  async update(adminId: string, id: string, input: UpdateGlobalTemplateDto): Promise<GlobalTemplateDto> {
    return this.db.platform.transaction(async (tx) => {
      const before = await this.lock(tx, id);
      const [r] = await tx
        .update(globalTemplates)
        .set({ name: input.name, description: input.description, category: input.category, sortOrder: input.sortOrder, updatedAt: new Date() })
        .where(eq(globalTemplates.id, id))
        .returning();
      await this.log(tx, adminId, 'global_template.updated', id, meta(before), meta(r!));
      return dto(r!);
    });
  }

  async saveContent(adminId: string, id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    return this.db.platform.transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.revision !== input.revision) throw new AppError('TEMPLATE_CONFLICT', { details: { currentRevision: row.revision } });
      const revision = row.revision + 1;
      await tx.update(globalTemplates).set({ content, revision, itemCount: countItems(content), updatedAt: new Date() }).where(eq(globalTemplates.id, id));
      await this.log(tx, adminId, 'global_template.updated', id, { revision: row.revision }, { revision });
      return { revision, issues: validateForPublish(content) };
    });
  }

  async setPublished(adminId: string, id: string, published: boolean): Promise<GlobalTemplateDto> {
    return this.db.platform.transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (published) {
        const issues = validateForPublish(storedContent(row.content));
        if (issues.length) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues } });
      }
      if (row.published === published) return dto(row);
      const [r] = await tx.update(globalTemplates).set({ published, updatedAt: new Date() }).where(eq(globalTemplates.id, id)).returning();
      await this.log(tx, adminId, published ? 'global_template.published' : 'global_template.unpublished', id, { published: row.published }, { published });
      return dto(r!);
    });
  }

  private async lock(tx: Tx, id: string): Promise<Row> {
    const [r] = await tx.select().from(globalTemplates).where(eq(globalTemplates.id, id)).for('update');
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private log(tx: Tx, adminId: string, action: string, id: string, before: unknown, after: unknown): Promise<void> {
    return this.audit.recordIn(tx, { tenantId: null, actorPlatformAdminId: adminId, action, entityType: 'global_template', entityId: id, before, after });
  }
}
