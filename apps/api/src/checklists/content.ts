import { type ChecklistContent, CONTENT_LIMITS, parseDraftContent } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/** Draft-schema parse used by every content write: size limit first, then structure. */
export function parseDraftOrThrow(raw: unknown): ChecklistContent {
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > CONTENT_LIMITS.contentBytes) throw new AppError('CHECKLIST_CONTENT_TOO_LARGE');
  const r = parseDraftContent(raw);
  if (!r.success) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues: r.issues } });
  return r.content;
}

/** Stored content was parsed on write; re-parse on read so a bad row fails loudly instead of leaking. */
export function storedContent(raw: unknown): ChecklistContent {
  const r = parseDraftContent(raw);
  if (!r.success) throw new Error('Stored checklist content failed validation');
  return r.content;
}
