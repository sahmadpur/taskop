import type { ChecklistContent } from '@taskop/contracts';
import { expect } from 'vitest';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';

/** Opens a draft from the current version, saves `content` and publishes it; returns the new version id. */
export async function publishNextVersion(api: Api, checklistId: string, content: ChecklistContent): Promise<string> {
  expect((await api.post(`/api/v1/checklists/${checklistId}/draft`, {})).status).toBe(201);
  expect((await api.put(`/api/v1/checklists/${checklistId}/draft`, { content, revision: 1 })).status).toBe(200);
  const res = await api.post(`/api/v1/checklists/${checklistId}/publish`, { revision: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
}

/** The checklist version an occurrence is pinned to, or null while unpinned. */
export async function pinnedVersionOf(occurrenceId: string): Promise<string | null> {
  return (await ownerQuery<{ v: string | null }>('select checklist_version_id as v from occurrences where id = $1', [occurrenceId])).rows[0]!.v;
}
