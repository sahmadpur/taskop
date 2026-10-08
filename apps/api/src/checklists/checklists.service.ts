import { Injectable, Optional } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ChecklistDetail,
  type ChecklistSummary,
  type ChecklistVersion,
  type ChecklistVersionSummary,
  type ContentSaveResult,
  type Page,
  regenerateIds,
  validateForPublish,
} from '@taskop/contracts';
import { and, desc, eq, getTableColumns, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklists, checklistVersions, users } from '../db/schema';
import { actorColumns } from './actor';
import { parseDraftOrThrow, storedContent } from './content';
import type { ChecklistListQueryDto, CreateChecklistDto, PublishDto, SaveContentDto, StartDraftDto, UpdateChecklistDto } from './dto';
import { toChecklistSummary, toVersionSummary, type VersionRow } from './mappers';

/** Implemented by TemplatesService (Task 8): template content with fresh ids, ready to become a draft. */
export abstract class ChecklistContentSource {
  abstract contentFromTemplate(kind: 'global' | 'tenant', templateId: string): Promise<ChecklistContent>;
}

type ChecklistRecord = typeof checklists.$inferSelect;

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Optional() private readonly templates?: ChecklistContentSource,
  ) {}

  async list(q: ChecklistListQueryDto): Promise<Page<ChecklistSummary>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.status) conditions.push(eq(checklists.status, q.status));
    if (q.category) conditions.push(eq(checklists.category, q.category));
    if (q.q) conditions.push(ilike(checklists.name, `%${escapeLike(q.q)}%`));
    if (q.hasDraft !== undefined) conditions.push(q.hasDraft ? sql`${this.draftRevisionSql()} is not null` : sql`${this.draftRevisionSql()} is null`);
    if (q.cursor) conditions.push(lt(checklists.id, q.cursor));
    const rows = await this.selectSummaries()
      .where(and(...conditions))
      .orderBy(desc(checklists.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toChecklistSummary);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(id: string): Promise<ChecklistDetail> {
    const [row] = await this.selectSummaries().where(eq(checklists.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    const versions = await this.selectVersions()
      .where(eq(checklistVersions.checklistId, id))
      .orderBy(sql`${checklistVersions.number} desc nulls first`);
    return {
      ...toChecklistSummary(row),
      currentVersionId: row.currentVersionId,
      source: row.sourceTemplateKind
        ? { kind: row.sourceTemplateKind, id: row.sourceTemplateId! }
        : row.sourceVersionId
          ? { kind: 'version', id: row.sourceVersionId }
          : null,
      versions: versions.map(toVersionSummary),
    };
  }

  async getVersion(id: string, versionId: string): Promise<ChecklistVersion> {
    return this.versionDto(and(eq(checklistVersions.id, versionId), eq(checklistVersions.checklistId, id)), 'NOT_FOUND');
  }

  async getDraft(id: string): Promise<ChecklistVersion> {
    await this.find(id);
    return this.versionDto(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')), 'CHECKLIST_NO_DRAFT');
  }

  async create(input: CreateChecklistDto): Promise<ChecklistDetail> {
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const from = input.from;
    let content: ChecklistContent = blankContent();
    if (from?.kind === 'version') {
      const [src] = await this.db.tx().select({ content: checklistVersions.content }).from(checklistVersions).where(eq(checklistVersions.id, from.versionId));
      if (!src) throw new AppError('REFERENCE_NOT_FOUND');
      content = regenerateIds(storedContent(src.content));
    } else if (from) {
      if (!this.templates) throw new AppError('REFERENCE_NOT_FOUND');
      content = await this.templates.contentFromTemplate(from.kind, from.templateId);
    }
    const tx = this.db.tx();
    const [row] = await tx
      .insert(checklists)
      .values({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        sourceTemplateKind: from && from.kind !== 'version' ? from.kind : null,
        sourceTemplateId: from && from.kind !== 'version' ? from.templateId : null,
        sourceVersionId: from?.kind === 'version' ? from.versionId : null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: checklists.id });
    await tx.insert(checklistVersions).values({
      tenantId,
      checklistId: row!.id,
      state: 'draft',
      content,
      createdByUserId: actor.userId,
      createdByPlatformAdminId: actor.platformAdminId,
    });
    const dto = await this.get(row!.id);
    await this.audit.record({
      action: 'checklist.created',
      entityType: 'checklist',
      entityId: dto.id,
      after: { name: dto.name, description: dto.description, category: dto.category, source: dto.source },
    });
    return dto;
  }

  async update(id: string, input: UpdateChecklistDto): Promise<ChecklistDetail> {
    const c = await this.lockActive(id);
    const before = { name: c.name, description: c.description, category: c.category };
    await this.db
      .tx()
      .update(checklists)
      .set({ name: input.name, description: input.description, category: input.category, updatedAt: new Date() })
      .where(eq(checklists.id, id));
    const after = await this.get(id);
    await this.audit.record({
      action: 'checklist.updated',
      entityType: 'checklist',
      entityId: id,
      before,
      after: { name: after.name, description: after.description, category: after.category },
    });
    return after;
  }

  async startDraft(id: string, input: StartDraftDto): Promise<ChecklistVersion> {
    const c = await this.lockActive(id);
    const tx = this.db.tx();
    const [existing] = await tx.select({ id: checklistVersions.id }).from(checklistVersions).where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')));
    if (existing) throw new AppError('CHECKLIST_DRAFT_EXISTS');
    const sourceId = input.fromVersionId ?? c.currentVersionId;
    let content: ChecklistContent = blankContent();
    let fromNumber: number | null = null;
    if (sourceId) {
      const [src] = await tx
        .select({ content: checklistVersions.content, number: checklistVersions.number })
        .from(checklistVersions)
        .where(and(eq(checklistVersions.id, sourceId), eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'published')));
      if (!src) throw new AppError('REFERENCE_NOT_FOUND');
      // Same node ids as the source version: results stay comparable across versions.
      content = storedContent(src.content);
      fromNumber = src.number;
    }
    const actor = actorColumns(this.db);
    await tx.insert(checklistVersions).values({
      tenantId: c.tenantId,
      checklistId: id,
      state: 'draft',
      content,
      createdByUserId: actor.userId,
      createdByPlatformAdminId: actor.platformAdminId,
    });
    await this.touch(id);
    await this.audit.record({ action: 'checklist.draft_started', entityType: 'checklist', entityId: id, after: { fromVersionNumber: fromNumber } });
    return this.getDraft(id);
  }

  async saveDraft(id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    await this.lockActive(id);
    const draft = await this.lockDraft(id, input.revision);
    const revision = draft.revision + 1;
    await this.db.tx().update(checklistVersions).set({ content, revision, updatedAt: new Date() }).where(eq(checklistVersions.id, draft.id));
    await this.touch(id);
    return { revision, issues: validateForPublish(content) };
  }

  async discardDraft(id: string): Promise<void> {
    await this.lockActive(id);
    const tx = this.db.tx();
    const [draft] = await tx
      .delete(checklistVersions)
      .where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')))
      .returning({ revision: checklistVersions.revision });
    if (!draft) throw new AppError('CHECKLIST_NO_DRAFT');
    await this.touch(id);
    await this.audit.record({ action: 'checklist.draft_discarded', entityType: 'checklist', entityId: id, before: { revision: draft.revision } });
  }

  async publish(id: string, input: PublishDto): Promise<ChecklistVersionSummary> {
    const c = await this.lockActive(id);
    const draft = await this.lockDraft(id, input.revision);
    const issues = validateForPublish(storedContent(draft.content));
    if (issues.length) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues } });
    const number = c.latestVersionNumber + 1;
    const actor = actorColumns(this.db);
    const now = new Date();
    const tx = this.db.tx();
    await tx
      .update(checklistVersions)
      .set({
        state: 'published',
        number,
        changeNote: input.changeNote ?? null,
        publishedByUserId: actor.userId,
        publishedByPlatformAdminId: actor.platformAdminId,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(checklistVersions.id, draft.id));
    await tx.update(checklists).set({ currentVersionId: draft.id, latestVersionNumber: number, updatedAt: now }).where(eq(checklists.id, id));
    await this.audit.record({
      action: 'checklist.published',
      entityType: 'checklist',
      entityId: id,
      after: { versionId: draft.id, number, changeNote: input.changeNote ?? null },
    });
    const [row] = await this.selectVersions().where(eq(checklistVersions.id, draft.id));
    return toVersionSummary(row!);
  }

  deactivate(id: string): Promise<ChecklistDetail> {
    return this.setStatus(id, 'deactivated');
  }

  reactivate(id: string): Promise<ChecklistDetail> {
    return this.setStatus(id, 'active');
  }

  private async setStatus(id: string, status: 'active' | 'deactivated'): Promise<ChecklistDetail> {
    const c = await this.lock(id);
    if (c.status !== status) {
      await this.db.tx().update(checklists).set({ status, updatedAt: new Date() }).where(eq(checklists.id, id));
      await this.audit.record({
        action: status === 'active' ? 'checklist.reactivated' : 'checklist.deactivated',
        entityType: 'checklist',
        entityId: id,
        before: { status: c.status },
        after: { status },
      });
    }
    return this.get(id);
  }

  // ---- helpers ----

  private draftRevisionSql() {
    // Qualified explicitly: in a select list Drizzle renders `${checklists.id}` as bare "id", which would bind to v.id.
    return sql<number | null>`(select v.revision from checklist_versions v where v.checklist_id = "checklists"."id" and v.state = 'draft')`;
  }

  private selectSummaries() {
    return this.db
      .tx()
      .select({ ...getTableColumns(checklists), draftRevision: this.draftRevisionSql() })
      .from(checklists)
      .$dynamic();
  }

  private selectVersions() {
    return this.db
      .tx()
      .select({
        id: checklistVersions.id,
        number: checklistVersions.number,
        state: checklistVersions.state,
        changeNote: checklistVersions.changeNote,
        publishedAt: checklistVersions.publishedAt,
        publishedByUserId: checklistVersions.publishedByUserId,
        publishedByPlatformAdminId: checklistVersions.publishedByPlatformAdminId,
        publisherName: users.fullName,
        createdAt: checklistVersions.createdAt,
      })
      .from(checklistVersions)
      .leftJoin(users, eq(users.id, checklistVersions.publishedByUserId))
      .$dynamic();
  }

  private async versionDto(where: SQL | undefined, missing: 'NOT_FOUND' | 'CHECKLIST_NO_DRAFT'): Promise<ChecklistVersion> {
    const [row] = await this.db
      .tx()
      .select({ v: getTableColumns(checklistVersions), publisherName: users.fullName })
      .from(checklistVersions)
      .leftJoin(users, eq(users.id, checklistVersions.publishedByUserId))
      .where(where);
    if (!row) throw new AppError(missing);
    const summary: VersionRow = { ...row.v, publisherName: row.publisherName };
    return { ...toVersionSummary(summary), checklistId: row.v.checklistId, revision: row.v.revision, content: storedContent(row.v.content) };
  }

  private async find(id: string): Promise<ChecklistRecord> {
    const [c] = await this.db.tx().select().from(checklists).where(eq(checklists.id, id));
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  /** Row lock: serialises publish/draft changes per checklist (no duplicate version numbers). */
  private async lock(id: string): Promise<ChecklistRecord> {
    const [c] = await this.db.tx().select().from(checklists).where(eq(checklists.id, id)).for('update');
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  private async lockActive(id: string): Promise<ChecklistRecord> {
    const c = await this.lock(id);
    if (c.status !== 'active') throw new AppError('CHECKLIST_DEACTIVATED');
    return c;
  }

  private async lockDraft(id: string, revision: number) {
    const [draft] = await this.db
      .tx()
      .select()
      .from(checklistVersions)
      .where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')))
      .for('update');
    if (!draft) throw new AppError('CHECKLIST_NO_DRAFT');
    if (draft.revision !== revision) throw new AppError('CHECKLIST_DRAFT_CONFLICT', { details: { currentRevision: draft.revision } });
    return draft;
  }

  private async touch(id: string): Promise<void> {
    await this.db.tx().update(checklists).set({ updatedAt: new Date() }).where(eq(checklists.id, id));
  }
}
