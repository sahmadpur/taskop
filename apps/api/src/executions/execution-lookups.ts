import { Injectable } from '@nestjs/common';
import { type ChecklistContent, type ClaimRef, type Item, type MediaKind, walkItems } from '@taskop/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { storedContent } from '../checklists/content';
import { DbService } from '../db/db.service';
import { checklistVersions, executionMedia, executions, users } from '../db/schema';

/** Small reads shared by the execution services. Run inside the tenant transaction. */
@Injectable()
export class ExecutionLookups {
  constructor(private readonly db: DbService) {}

  async content(versionId: string): Promise<ChecklistContent> {
    const [v] = await this.db.tx().select({ content: checklistVersions.content }).from(checklistVersions).where(eq(checklistVersions.id, versionId));
    if (!v) throw new Error(`Checklist version ${versionId} not found`);
    return storedContent(v.content);
  }

  /** Who holds the claim (the counted, non-rejected execution) of each occurrence. */
  async claims(occurrenceIds: string[]): Promise<Map<string, ClaimRef>> {
    if (!occurrenceIds.length) return new Map();
    const rows = await this.db
      .tx()
      .select({ occurrenceId: executions.occurrenceId, executionId: executions.id, executorUserId: executions.executorUserId, executorName: users.fullName })
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(and(inArray(executions.occurrenceId, occurrenceIds), ne(executions.state, 'rejected')));
    return new Map(rows.map(({ occurrenceId, ...claim }) => [occurrenceId, claim]));
  }

  /** Media registered on an execution, by id: what answers may reference (spec §6.3). */
  async mediaKinds(executionId: string): Promise<Map<string, MediaKind>> {
    const rows = await this.db.tx().select({ id: executionMedia.id, kind: executionMedia.kind }).from(executionMedia).where(eq(executionMedia.executionId, executionId));
    return new Map(rows.map((r) => [r.id, r.kind]));
  }
}

export function findItem(content: ChecklistContent, itemId: string): Item | undefined {
  let found: Item | undefined;
  walkItems(content, (item) => {
    if (item.id === itemId) found = item;
  });
  return found;
}
