import type { ChecklistSummary, ChecklistVersionSummary } from '@taskop/contracts';

export interface ChecklistRow {
  id: string;
  name: string;
  description: string | null;
  category: ChecklistSummary['category'];
  status: ChecklistSummary['status'];
  latestVersionNumber: number;
  draftRevision: number | null;
  updatedAt: Date;
}

export const toChecklistSummary = (r: ChecklistRow): ChecklistSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  category: r.category,
  status: r.status,
  currentVersionNumber: r.latestVersionNumber > 0 ? r.latestVersionNumber : null,
  draftRevision: r.draftRevision,
  updatedAt: r.updatedAt.toISOString(),
});

export interface VersionRow {
  id: string;
  number: number | null;
  state: 'draft' | 'published';
  changeNote: string | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  publishedByPlatformAdminId: string | null;
  publisherName: string | null;
  createdAt: Date;
}

export const toVersionSummary = (r: VersionRow): ChecklistVersionSummary => ({
  id: r.id,
  number: r.number,
  state: r.state,
  changeNote: r.changeNote,
  publishedAt: r.publishedAt?.toISOString() ?? null,
  publishedBy: r.publishedByUserId
    ? { kind: 'user', name: r.publisherName }
    : r.publishedByPlatformAdminId
      ? { kind: 'platform', name: null }
      : null,
  createdAt: r.createdAt.toISOString(),
});
