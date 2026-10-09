import { z } from 'zod';
import { type ChecklistContent, CONTENT_LIMITS, type ContentIssue, hasRules, type Item, PROBLEM_SEVERITIES, walkItems } from './checklist-content.js';
import type { Answers } from './checklist-logic.js';
import { idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, progressSchema, scoreSchema } from './execution-logic.js';

const MB = 1024 * 1024;

export const MEDIA_KINDS = ['photo', 'video'] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;
export const MEDIA_SOURCES = ['camera', 'gallery'] as const;
export const mediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof mediaSourceSchema>;
export const MEDIA_STATUSES = ['pending', 'uploaded'] as const;
export const mediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

/** Spec §1, §4, §6.7. The phone resizes and records within these; the API refuses anything beyond them. */
export const MEDIA_LIMITS = {
  photoLongEdge: 1600,
  jpegQuality: 0.7,
  photoMaxBytes: 5 * MB,
  videoMaxSeconds: 60,
  videoMaxBytes: 60 * MB,
  /** 720p: the short edge of a video frame. */
  videoMaxShortEdge: 720,
  mimeTypes: { photo: ['image/jpeg', 'image/png'], video: ['video/mp4', 'video/quicktime'] },
  extensions: { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/quicktime': 'mov' },
  problemMaxMedia: 5,
  /** Evidence photos (or videos) on an item that is not itself a photo or video item. */
  evidencePerItem: 5,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
  pendingCleanupDays: 14,
} as const;

export const EXECUTION_LIMITS = {
  answersBytes: 1_000_000,
  problemNote: 2000,
  answerNote: 2000,
  /** A device time later than server receipt + 2 min is CLOCK_INVALID (spec §6.6). */
  clockFutureToleranceMs: 2 * 60_000,
  /** |clientOffsetMs| above this marks the execution clock_suspect. */
  clockSkewMs: 5 * 60_000,
  /** Starting more than this before starts_at marks the execution clock_suspect. */
  earlyStartToleranceMs: 5 * 60_000,
  syncPastDays: 1,
  syncFutureDays: 3,
  syncFinishedHours: 24,
  problemsMaxDays: 92,
} as const;

export const EXECUTION_ISSUE_CODES = [
  'executions.issues.unknownItem',
  'executions.issues.invalidValue',
  'executions.issues.unknownOption',
  'executions.issues.unknownMedia',
  'executions.issues.tooManyMedia',
  'executions.issues.answersTooLarge',
  'executions.issues.rangeTooLong',
] as const;
export type ExecutionIssueCode = (typeof EXECUTION_ISSUE_CODES)[number];

export const manualProblemSchema = z.object({
  severity: z.enum(PROBLEM_SEVERITIES),
  note: z.string().trim().min(1).max(EXECUTION_LIMITS.problemNote),
  mediaIds: z.array(idSchema).max(MEDIA_LIMITS.problemMaxMedia),
});

/** One item's answer (SP2 `Answer` plus the manual problem). Unknown fields are refused. */
export const answerSchema = z.strictObject({
  optionIds: z.array(idSchema).max(CONTENT_LIMITS.options).optional(),
  number: z.number().optional(),
  text: z.string().max(5000).optional(),
  datetime: z.string().max(40).optional(),
  photos: z.array(idSchema).max(20).optional(),
  videos: z.array(idSchema).max(5).optional(),
  note: z.string().max(EXECUTION_LIMITS.answerNote).optional(),
  problem: manualProblemSchema.optional(),
});

/** `ExecutionAnswersDoc` (spec §4): item ID → answer, at most 1 MB serialised. */
export const answersSchema = z.record(idSchema, answerSchema).superRefine((v, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(v)).length > EXECUTION_LIMITS.answersBytes) {
    ctx.addIssue({ code: 'custom', message: 'executions.issues.answersTooLarge' });
  }
});

/** May this item carry evidence of this kind (beyond being a photo/video item itself)? */
export function evidenceAllows(item: Item, kind: MediaKind): boolean {
  if (item.evidence[kind] !== 'none') return true;
  return hasRules(item) && item.rules.some((r) => (kind === 'photo' ? r.then.requirePhoto : r.then.requireVideo));
}

/** How many media of `kind` an item's answer may hold (the server's MEDIA_LIMIT_REACHED storage cap derives from it). */
export function mediaLimitFor(item: Item, kind: MediaKind): number {
  if (item.type === 'photo' || item.type === 'video') return item.type === kind ? item.maxCount : 0;
  return evidenceAllows(item, kind) ? MEDIA_LIMITS.evidencePerItem : 0;
}

const DATETIME_FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
} as const;

/** A medium registered on the execution, as answers may reference it: its kind and the item it was taken for (null = problem-only). */
export interface RegisteredMedia {
  kind: MediaKind;
  itemId: string | null;
}

/**
 * Checks answers against the pinned version (spec §6.3): item IDs, value types, options, limits and media IDs.
 * `media` maps the media IDs registered on the execution. An item's photos/videos must be media registered for that
 * item; a problem's media may also be problem-only ones. A medium listed twice in one list is invalid.
 * Answers to hidden items are allowed.
 */
export function answerIssues(content: ChecklistContent, answers: Answers, media: ReadonlyMap<string, RegisteredMedia>): ContentIssue[] {
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  const issues: ContentIssue[] = [];
  const add = (path: (string | number)[], code: ExecutionIssueCode) => issues.push({ path: ['answers', ...path], code });
  /** Duplicates, then each id against `fits`. */
  const checkIds = (path: (string | number)[], ids: readonly string[], fits: (m: RegisteredMedia) => boolean) => {
    ids.forEach((id, i) => {
      const m = media.get(id);
      if (ids.indexOf(id) !== i) add([...path, i], 'executions.issues.invalidValue');
      else if (!m || !fits(m)) add([...path, i], 'executions.issues.unknownMedia');
    });
  };
  for (const [itemId, a] of Object.entries(answers)) {
    const item = items.get(itemId);
    if (!item) {
      add([itemId], 'executions.issues.unknownItem');
      continue;
    }
    if (!a) continue;
    if (a.optionIds !== undefined) {
      if (!('options' in item)) add([itemId, 'optionIds'], 'executions.issues.invalidValue');
      else if (a.optionIds.some((id) => !(item.options as ReadonlyArray<{ id: string }>).some((o) => o.id === id))) add([itemId, 'optionIds'], 'executions.issues.unknownOption');
      else if (item.type !== 'multi_choice' && a.optionIds.length > 1) add([itemId, 'optionIds'], 'executions.issues.invalidValue');
    }
    if (a.number !== undefined && (item.type !== 'number' || (item.min !== null && a.number < item.min) || (item.max !== null && a.number > item.max))) {
      add([itemId, 'number'], 'executions.issues.invalidValue');
    }
    if (a.text !== undefined && ((item.type !== 'text' && item.type !== 'comment') || a.text.length > item.maxLength)) {
      add([itemId, 'text'], 'executions.issues.invalidValue');
    }
    if (a.datetime !== undefined && (item.type !== 'datetime' || !DATETIME_FORMATS[item.mode].test(a.datetime))) {
      add([itemId, 'datetime'], 'executions.issues.invalidValue');
    }
    for (const [field, kind] of [['photos', 'photo'], ['videos', 'video']] as const) {
      const ids = a[field];
      if (ids === undefined) continue;
      const limit = mediaLimitFor(item, kind);
      if (limit === 0) {
        add([itemId, field], 'executions.issues.invalidValue');
        continue;
      }
      if (ids.length > limit) add([itemId, field], 'executions.issues.tooManyMedia');
      checkIds([itemId, field], ids, (m) => m.kind === kind && m.itemId === item.id);
    }
    if (a.problem) checkIds([itemId, 'problem', 'mediaIds'], a.problem.mediaIds, (m) => m.itemId === null || m.itemId === item.id);
  }
  return issues;
}

export const deviceInfoSchema = z.object({ platform: z.enum(['ios', 'android']), osVersion: z.string().max(50), appVersion: z.string().max(50) });
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/** Every upload command carries the device time and the offset measured at the last sync (spec §6.6). */
const commandTiming = {
  deviceTime: isoDateTimeSchema,
  clientOffsetMs: z.number().int().min(-2_000_000_000).max(2_000_000_000),
};

export const claimCommandSchema = z.object({ id: idSchema, occurrenceId: idSchema, startedAt: isoDateTimeSchema, device: deviceInfoSchema, ...commandTiming });
export type ClaimCommand = z.input<typeof claimCommandSchema>;

export const saveAnswersCommandSchema = z.object({ rev: z.number().int().min(1), answers: answersSchema, ...commandTiming });
export type SaveAnswersCommand = z.input<typeof saveAnswersCommandSchema>;

export const completeCommandSchema = saveAnswersCommandSchema.extend({ completedAt: isoDateTimeSchema });
export type CompleteCommand = z.input<typeof completeCommandSchema>;

export const registerMediaCommandSchema = z.object({
  id: idSchema,
  /** null = attached only to a manual problem; the problem's item is in the answers. */
  itemId: idSchema.nullable(),
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  mime: z.string().max(100),
  bytes: z.number().int().min(1),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  capturedAt: isoDateTimeSchema,
  ...commandTiming,
});
export type RegisterMediaCommand = z.input<typeof registerMediaCommandSchema>;

export const claimRefSchema = z.object({ executionId: idSchema, executorUserId: idSchema, executorName: z.string() });
export type ClaimRef = z.infer<typeof claimRefSchema>;

export const claimResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  reason: claimRejectionReasonSchema.nullable(),
  /** Who holds the claim now (the caller when accepted). */
  claim: claimRefSchema.nullable(),
  checklistVersionId: idSchema,
  /** After clamping (spec §6.6). */
  startedAt: isoDateTimeSchema,
  clockSuspect: z.boolean(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

export const saveAnswersResultSchema = z.object({
  executionId: idSchema,
  /** The stored revision; with `stale: true` the command was ignored. */
  rev: z.number().int(),
  stale: z.boolean(),
  state: executionStateSchema,
  progress: progressSchema,
});
export type SaveAnswersResult = z.infer<typeof saveAnswersResultSchema>;

export const completeResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  completedAt: isoDateTimeSchema.nullable(),
  late: z.boolean(),
  progress: progressSchema,
  score: scoreSchema.nullable(),
});
export type CompleteResult = z.infer<typeof completeResultSchema>;

export const mediaUploadTicketSchema = z.object({
  mediaId: idSchema,
  status: mediaStatusSchema,
  /** Presigned PUT, valid 15 min; send exactly `headers`. Null once the medium is uploaded: nothing more to send. */
  uploadUrl: z.url().nullable(),
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema.nullable(),
});
export type MediaUploadTicket = z.infer<typeof mediaUploadTicketSchema>;

export const mediaConfirmResultSchema = z.object({ mediaId: idSchema, status: mediaStatusSchema, uploadedAt: isoDateTimeSchema.nullable() });
export type MediaConfirmResult = z.infer<typeof mediaConfirmResultSchema>;

export const mediaUrlSchema = z.object({ url: z.url(), expiresAt: isoDateTimeSchema });
export type MediaUrl = z.infer<typeof mediaUrlSchema>;
