import { Injectable } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ContentSaveResult,
  countItems,
  regenerateIds,
  type TemplateDto,
  type TemplateSummary,
  validateForPublish,
} from '@taskop/contracts';
import { and, asc, eq, ilike, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklistVersions, globalTemplatesPublished, tenantTemplates } from '../db/schema';
import { actorColumns } from './actor';
import { ChecklistContentSource } from './checklists.service';
import { parseDraftOrThrow, storedContent } from './content';
import type { CreateTemplateDto, SaveAsTemplateDto, SaveContentDto, TemplateListQueryDto, UpdateTemplateDto } from './dto';

type TenantTemplateRow = typeof tenantTemplates.$inferSelect;
type GlobalRow = typeof globalTemplatesPublished.$inferSelect;

const tenantSummary = (r: TenantTemplateRow): TemplateSummary => ({
  id: r.id,
  source: 'tenant',
  name: r.name,
  description: r.description,
  category: r.category,
  status: r.status,
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const globalSummary = (r: GlobalRow): TemplateSummary => ({
  id: r.id,
  source: 'global',
  name: r.name,
  description: r.description,
  category: r.category,
  status: 'active',
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const meta = (r: { name: string; description: string | null; category: string }) => ({ name: r.name, description: r.description, category: r.category });

@Injectable()
export class TemplatesService extends ChecklistContentSource {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async list(q: TemplateListQueryDto): Promise<TemplateSummary[]> {
    const like = q.q ? `%${escapeLike(q.q)}%` : null;
    const out: TemplateSummary[] = [];
    if (q.source !== 'tenant' && q.status !== 'deactivated') {
      const g: (SQL | undefined)[] = [];
      if (q.category) g.push(eq(globalTemplatesPublished.category, q.category));
      if (like) g.push(ilike(globalTemplatesPublished.name, like));
      const rows = await this.db
        .tx()
        .select()
        .from(globalTemplatesPublished)
        .where(and(...g))
        .orderBy(asc(globalTemplatesPublished.sortOrder), asc(globalTemplatesPublished.name));
      out.push(...rows.map(globalSummary));
    }
    if (q.source !== 'global') {
      const c: (SQL | undefined)[] = [];
      if (q.category) c.push(eq(tenantTemplates.category, q.category));
      if (q.status) c.push(eq(tenantTemplates.status, q.status));
      if (like) c.push(ilike(tenantTemplates.name, like));
      const rows = await this.db.tx().select().from(tenantTemplates).where(and(...c)).orderBy(asc(tenantTemplates.name));
      out.push(...rows.map(tenantSummary));
    }
    return out;
  }

  async get(source: 'global' | 'tenant', id: string): Promise<TemplateDto> {
    if (source === 'global') {
      const [r] = await this.db.tx().select().from(globalTemplatesPublished).where(eq(globalTemplatesPublished.id, id));
      if (!r) throw new AppError('NOT_FOUND');
      return { ...globalSummary(r), revision: r.revision, content: storedContent(r.content) };
    }
    const r = await this.find(id);
    return { ...tenantSummary(r), revision: r.revision, content: storedContent(r.content) };
  }

  async contentFromTemplate(kind: 'global' | 'tenant', templateId: string): Promise<ChecklistContent> {
    let raw: unknown;
    if (kind === 'global') {
      const [r] = await this.db.tx().select({ content: globalTemplatesPublished.content }).from(globalTemplatesPublished).where(eq(globalTemplatesPublished.id, templateId));
      if (!r) throw new AppError('REFERENCE_NOT_FOUND');
      raw = r.content;
    } else {
      const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, templateId));
      if (!r) throw new AppError('REFERENCE_NOT_FOUND');
      if (r.status !== 'active') throw new AppError('TEMPLATE_DEACTIVATED');
      raw = r.content;
    }
    return regenerateIds(storedContent(raw));
  }

  async create(input: CreateTemplateDto): Promise<TemplateDto> {
    const content = input.content === undefined ? blankContent() : parseDraftOrThrow(input.content);
    return this.insert({ name: input.name, description: input.description ?? null, category: input.category, content });
  }

  async saveVersionAsTemplate(checklistId: string, versionId: string, input: SaveAsTemplateDto): Promise<TemplateDto> {
    const [v] = await this.db
      .tx()
      .select({ content: checklistVersions.content })
      .from(checklistVersions)
      .where(and(eq(checklistVersions.id, versionId), eq(checklistVersions.checklistId, checklistId), eq(checklistVersions.state, 'published')));
    if (!v) throw new AppError('NOT_FOUND');
    return this.insert({
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      content: regenerateIds(storedContent(v.content)),
      sourceChecklistId: checklistId,
      sourceVersionId: versionId,
    });
  }

  async update(id: string, input: UpdateTemplateDto): Promise<TemplateDto> {
    const before = await this.lockActive(id);
    await this.db
      .tx()
      .update(tenantTemplates)
      .set({ name: input.name, description: input.description, category: input.category, updatedAt: new Date() })
      .where(eq(tenantTemplates.id, id));
    const after = await this.get('tenant', id);
    await this.audit.record({ action: 'template.updated', entityType: 'template', entityId: id, before: meta(before), after: meta(after) });
    return after;
  }

  async saveContent(id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    const row = await this.lockActive(id);
    if (row.revision !== input.revision) throw new AppError('TEMPLATE_CONFLICT', { details: { currentRevision: row.revision } });
    const revision = row.revision + 1;
    await this.db
      .tx()
      .update(tenantTemplates)
      .set({ content, revision, itemCount: countItems(content), updatedAt: new Date() })
      .where(eq(tenantTemplates.id, id));
    await this.audit.record({ action: 'template.updated', entityType: 'template', entityId: id, before: { revision: row.revision }, after: { revision } });
    return { revision, issues: validateForPublish(content) };
  }

  deactivate(id: string): Promise<TemplateDto> {
    return this.setStatus(id, 'deactivated');
  }

  reactivate(id: string): Promise<TemplateDto> {
    return this.setStatus(id, 'active');
  }

  private async setStatus(id: string, status: 'active' | 'deactivated'): Promise<TemplateDto> {
    const row = await this.lock(id);
    if (row.status !== status) {
      await this.db.tx().update(tenantTemplates).set({ status, updatedAt: new Date() }).where(eq(tenantTemplates.id, id));
      await this.audit.record({
        action: status === 'active' ? 'template.reactivated' : 'template.deactivated',
        entityType: 'template',
        entityId: id,
        before: { status: row.status },
        after: { status },
      });
    }
    return this.get('tenant', id);
  }

  private async insert(v: {
    name: string;
    description: string | null;
    category: TenantTemplateRow['category'];
    content: ChecklistContent;
    sourceChecklistId?: string;
    sourceVersionId?: string;
  }): Promise<TemplateDto> {
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const [row] = await this.db
      .tx()
      .insert(tenantTemplates)
      .values({
        tenantId,
        name: v.name,
        description: v.description,
        category: v.category,
        content: v.content,
        itemCount: countItems(v.content),
        sourceChecklistId: v.sourceChecklistId ?? null,
        sourceVersionId: v.sourceVersionId ?? null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: tenantTemplates.id });
    const dto = await this.get('tenant', row!.id);
    await this.audit.record({
      action: 'template.created',
      entityType: 'template',
      entityId: dto.id,
      after: { ...meta(dto), sourceChecklistId: v.sourceChecklistId ?? null, sourceVersionId: v.sourceVersionId ?? null },
    });
    return dto;
  }

  private async find(id: string): Promise<TenantTemplateRow> {
    const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, id));
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async lock(id: string): Promise<TenantTemplateRow> {
    const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, id)).for('update');
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async lockActive(id: string): Promise<TenantTemplateRow> {
    const r = await this.lock(id);
    if (r.status !== 'active') throw new AppError('TEMPLATE_DEACTIVATED');
    return r;
  }
}
