import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  CANCEL_REASON_CODES,
  CLAIM_REJECTION_REASONS,
  describeSchedule,
  EXECUTION_ISSUE_CODES,
  EVIDENCE_LEVELS,
  EXECUTION_STATES,
  ErrorCode,
  ISSUE_CODES,
  ITEM_TYPES,
  MEDIA_KINDS,
  MEDIA_SOURCES,
  MISSING_KINDS,
  OCCURRENCE_STATUSES,
  PERMISSION_GROUPS,
  PREVIEW_WARNINGS,
  PROBLEM_RESOLUTIONS,
  PROBLEM_SEVERITIES,
  PROBLEM_SOURCES,
  SCHEDULING_ISSUE_CODES,
  TASK_HISTORY_REASONS,
  TASK_ISSUE_CODES,
  TASK_MEDIA_ROLES,
  TASK_PRIORITIES,
  TASK_REVIEW_DECISIONS,
  TASK_SOURCES,
  TASK_STATUSES,
  TEMPLATE_CATEGORIES,
} from '@taskop/contracts';
import { az, formatDate, formatDateTime } from './index.js';

describe('az translations', () => {
  it('has a message for every API error code', () => {
    for (const code of Object.values(ErrorCode)) expect(az.errors[code], code).toBeTypeOf('string');
  });
  it('has every validation key used by contracts', () => {
    for (const k of ['required', 'invalid', 'tooShort', 'tooLong', 'email', 'username', 'orgCode', 'pinFormat', 'pinWeak', 'passwordLength', 'timezone'] as const) {
      expect(az.errors.validation[k], k).toBeTypeOf('string');
    }
  });
});

describe('checklist translations', () => {
  it('translates every content issue code', () => {
    for (const code of ISSUE_CODES) expect(az.checklists.issues[code], code).toBeTypeOf('string');
  });
  it('translates categories and item types', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(az.checklists.categories[c], c).toBeTypeOf('string');
    for (const t of ITEM_TYPES) expect(az.checklists.itemTypes[t], t).toBeTypeOf('string');
  });
  it('labels every permission group and key', () => {
    for (const g of PERMISSION_GROUPS) expect(az.roles.groups[g.group as keyof typeof az.roles.groups], g.group).toBeTypeOf('string');
    for (const k of ALL_PERMISSIONS) expect(az.roles.keys[k.replace('.', '_') as keyof typeof az.roles.keys], k).toBeTypeOf('string');
  });
});

describe('formatting', () => {
  it('formats in the tenant timezone', () => {
    expect(formatDateTime('2026-10-07T10:00:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('14:00');
  });
  it('formats dates', () => {
    expect(formatDate('2026-10-07T22:30:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('2026');
  });
});

describe('scheduling translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);
  const t = (key: string, vars: Record<string, string | number> = {}) =>
    String(lookup(key)).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name]));

  it('translates issue codes, statuses, cancel reasons and warnings', () => {
    for (const code of SCHEDULING_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
    for (const s of OCCURRENCE_STATUSES) expect(az.scheduling.statuses[s], s).toBeTypeOf('string');
    for (const r of CANCEL_REASON_CODES) expect(az.scheduling.cancelReasons[r], r).toBeTypeOf('string');
    for (const w of PREVIEW_WARNINGS) expect(az.scheduling.warnings[w], w).toBeTypeOf('string');
  });

  it('renders schedule summaries in Azerbaijani', () => {
    const r0 = { startDate: '2026-11-02', endDate: null, skipDates: [] };
    const fixed = { mode: 'fixed' as const, startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 0 };
    expect(describeSchedule({ kind: 'weekly', every: 1, weekdays: [1, 3], ...r0 }, fixed, null, t)).toBe('Hər həftə: B.e., Ç., 08:00–10:00');
    expect(describeSchedule({ kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...r0 }, fixed, null, t)).toBe('Hər ay, sonuncu Cümə, 08:00–10:00');
    expect(describeSchedule({ kind: 'daily', every: 1, ...r0 }, { mode: 'shift', shiftId: 'x', graceMinutes: 0 }, 'Səhər', t)).toBe('Hər gün, Səhər növbəsi');
  });

  it('has the UI strings the web screens use', () => {
    for (const k of ['assignments', 'schedule', 'shifts', 'roster'] as const) expect(az.nav[k], k).toBeTypeOf('string');
    for (const k of ['once', 'daily', 'weekly', 'monthly', 'dates'] as const) expect(az.scheduling.builder.kinds[k], k).toBeTypeOf('string');
    for (const k of ['active', 'paused', 'ended'] as const) expect(az.scheduling.assignments.status[k], k).toBeTypeOf('string');
    expect(az.scheduling.roster.cellLabel).toContain('{{person}}');
  });
});

describe('execution translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('translates states, claim rejections, issue codes, sources, severities and media labels', () => {
    for (const s of EXECUTION_STATES) expect(az.executions.states[s], s).toBeTypeOf('string');
    for (const r of CLAIM_REJECTION_REASONS) expect(az.executions.claimRejections[r], r).toBeTypeOf('string');
    for (const code of EXECUTION_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
    for (const s of PROBLEM_SOURCES) expect(az.executions.problemSources[s], s).toBeTypeOf('string');
    for (const s of PROBLEM_SEVERITIES) expect(az.executions.severities[s], s).toBeTypeOf('string');
    for (const k of MEDIA_KINDS) expect(az.executions.mediaKinds[k], k).toBeTypeOf('string');
    for (const k of MEDIA_SOURCES) expect(az.executions.mediaSources[k], k).toBeTypeOf('string');
  });

  it('uses the spec wording for the clock and the lost claim', () => {
    expect(az.errors.CLOCK_INVALID).toBe('Telefonun saatını yoxlayın.');
    expect(az.executions.alreadyClaimedBy.replace('{{name}}', 'Murad')).toBe('Bu checklist artıq Murad tərəfindən icra olunur');
    expect(az.executions.flags.mediaPending).toContain('{{count}}');
  });
});

describe('execution web translations', () => {
  it('has the strings the drawer, the schedule list and the problems page use', () => {
    expect(az.nav.problems).toBe('Problemlər');
    expect(az.executions.tabs).toEqual({ overview: 'Ümumi', execution: 'İcra' });
    expect(az.executions.rejected.title).toBe('Rədd edilmiş icralar ({{count}})');
    expect(az.executions.receivedAt).toContain('{{time}}');
    expect(az.executions.progressValue).toContain('{{answered}}');
    expect(az.executions.media.pendingLabel).toContain('{{kind}}');
    for (const k of ['date', 'site', 'checklist', 'item', 'severity', 'source', 'note', 'executor', 'media'] as const) {
      expect(az.executions.problemsPage.columns[k], k).toBeTypeOf('string');
    }
  });
});

describe('mobile execution translations', () => {
  it('labels every missing kind, outbox command, start block and sync state', () => {
    for (const k of MISSING_KINDS) expect(az.mobile.finish.missingKinds[k], k).toBeTypeOf('string');
    for (const k of ['claim', 'media', 'answers', 'complete', 'upload'] as const) expect(az.mobile.sync.kinds[k], k).toBeTypeOf('string');
    for (const k of ['notYetOpen', 'closed', 'claimedByOther', 'finished', 'needsUpdate', 'notDownloaded', 'clockAhead'] as const) {
      expect(az.mobile.checklists.startBlocked[k], k).toBeTypeOf('string');
    }
    for (const k of ['synced', 'pending', 'offline', 'failed'] as const) expect(az.mobile.sync[k], k).toBeTypeOf('string');
    for (const k of ['FILE_MISSING', 'UPLOAD_FAILED'] as const) expect(az.mobile.sync.mediaErrors[k], k).toBeTypeOf('string');
    for (const k of ['tooLong', 'tooLarge', 'resolution'] as const) expect(az.mobile.evidence[k], k).toBeTypeOf('string');
  });

  it('uses the spec wording', () => {
    expect(az.mobile.checklists.sections).toEqual({ now: 'İndi', inProgress: 'Davam edən', upcoming: 'Gələcək', done: 'Bitmiş' });
    expect(az.mobile.checklists.claimedBy.replace('{{name}}', 'Murad')).toBe('Murad icra edir');
    expect(az.mobile.checklists.startBlocked.clockAhead).toBe('Telefonun saatı irəlidədir. Saatı düzəldin və yenidən cəhd edin.');
    expect(az.mobile.sync.pending.replace('{{count}}', '3')).toBe('3 gözləyir');
    expect(az.mobile.sync.retry).toBe('Yenidən cəhd et');
    expect(az.mobile.execution.flagProblem).toBe('Problem qeyd et');
    expect(az.mobile.execution.needsUpdate).toBe('Tətbiqi yeniləyin');
    expect(az.mobile.finish.complete).toBe('Tamamla');
    expect(az.mobile.sync.notAccepted.replace('{{reason}}', 'X')).toBe('Server qəbul etmədi: X');
    expect(az.mobile.sync.fileNotAccepted.replace('{{reason}}', 'X')).toBe('Server bu faylı qəbul etmədi: X');
    expect(az.mobile.sync.discard).toBe('Sil');
  });

  it('has the discard confirmation texts', () => {
    for (const k of ['discardTitle', 'discardBody', 'discardClaimBody'] as const) expect(az.mobile.sync[k], k).toBeTypeOf('string');
  });
});

describe('task translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('translates statuses, priorities, sources, resolutions, evidence, roles, decisions, reasons and issues', () => {
    for (const s of TASK_STATUSES) expect(az.tasks.statuses[s], s).toBeTypeOf('string');
    for (const p of TASK_PRIORITIES) expect(az.tasks.priorities[p], p).toBeTypeOf('string');
    for (const s of TASK_SOURCES) expect(az.tasks.sources[s], s).toBeTypeOf('string');
    for (const r of PROBLEM_RESOLUTIONS) expect(az.tasks.resolutions[r], r).toBeTypeOf('string');
    for (const l of EVIDENCE_LEVELS) expect(az.tasks.evidenceLevels[l], l).toBeTypeOf('string');
    for (const r of TASK_MEDIA_ROLES) expect(az.tasks.mediaRoles[r], r).toBeTypeOf('string');
    for (const d of TASK_REVIEW_DECISIONS) expect(az.tasks.reviewDecisions[d], d).toBeTypeOf('string');
    for (const r of TASK_HISTORY_REASONS) expect(az.tasks.historyReasons[r], r).toBeTypeOf('string');
    for (const code of TASK_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
  });

  it('uses the spec wording and registers the task nav, audit and role labels', () => {
    expect(az.errors.TASK_ALREADY_TAKEN).toBe('Bu tapşırığı artıq başqası qəbul edib.');
    expect(az.tasks.alreadyTaken).toBe('Bu tapşırığı artıq başqası qəbul edib');
    expect(az.tasks.statuses.accepted).toBe('Qəbul edilib');
    expect(az.tasks.statuses.in_progress).toBe('İcradadır');
    expect(az.tasks.flags.overdue).toBe('Gecikib');
    expect(az.nav.tasks).toBe('Tapşırıqlar');
    expect(az.audit.entityTypes.task).toBe('Tapşırıq');
  });
});

describe('mobile task translations', () => {
  it('labels the tasks tab, its sections, the task commands and every task screen', () => {
    expect(az.mobile.tabs.tasks).toBe('Tapşırıqlar');
    for (const k of ['accept', 'start', 'media', 'submit'] as const) expect(az.mobile.sync.kinds.task[k], k).toBeTypeOf('string');
    for (const k of ['open', 'overdue', 'title'] as const) expect(az.mobile.tasks.home[k], k).toBeTypeOf('string');
    for (const k of [
      'instructions', 'noInstructions', 'problem', 'accept', 'start', 'response', 'responsePlaceholder', 'complete', 'submitted',
      'readOnly', 'rejected', 'cancelled', 'mediaOffline', 'mediaFailed', 'notFound',
    ] as const) {
      expect(az.mobile.tasks.detail[k], k).toBeTypeOf('string');
    }
    for (const k of [
      'open', 'title', 'name', 'instructions', 'priority', 'assignee', 'search', 'teams', 'people', 'teamOption', 'site', 'noSite',
      'due', 'review', 'evidence', 'photos', 'save', 'created', 'titleRequired', 'assigneeRequired',
    ] as const) {
      expect(az.mobile.tasks.create[k], k).toBeTypeOf('string');
    }
    for (const k of ['title', 'approve', 'reject', 'comment', 'approved', 'rejected', 'submission', 'empty', 'notReviewable'] as const) {
      expect(az.mobile.tasks.review[k], k).toBeTypeOf('string');
    }
  });

  it('uses the spec wording', () => {
    expect(az.mobile.tasks.sections).toEqual({ team: 'Komanda üçün', mine: 'Mənim', inReview: 'Yoxlamada', done: 'Tamamlanıb', review: 'Yoxlama' });
    expect(az.mobile.tasks.detail.accept).toBe('Qəbul et');
    expect(az.mobile.tasks.detail.start).toBe('Başla');
    expect(az.mobile.tasks.detail.complete).toBe('Tamamla');
    expect(az.mobile.tasks.online).toBe('İnternet bağlantısı tələb olunur');
    expect(az.mobile.tasks.home.open.replace('{{count}}', '2')).toBe('Açıq: 2');
    expect(az.mobile.tasks.create.teamOption.replace('{{name}}', 'Texniki xidmət').replace('{{count}}', '3')).toBe('Texniki xidmət (3 nəfər)');
  });
});

describe('task web translations', () => {
  it('has the strings the tasks page, the dialog, the drawer and the problems page use', () => {
    expect(az.tasks.page.tabs).toEqual({ all: 'Hamısı', review: 'Yoxlamamı gözləyir', overdue: 'Gecikmiş', mine: 'Mənim yaratdıqlarım' });
    expect(az.tasks.page.new).toBe('Yeni tapşırıq');
    for (const k of ['title', 'status', 'assignee', 'site', 'due', 'source'] as const) expect(az.tasks.page.columns[k], k).toBeTypeOf('string');
    expect(az.tasks.page.teamWaiting).toContain('{{team}}');
    expect(az.tasks.picker.members).toContain('{{count}}');
    expect(az.tasks.dialog.dueHint).toContain('{{timeZone}}');
    expect(az.tasks.dialog.siteFromProblem).toContain('{{site}}');
    expect(az.tasks.dialog.uploadFailed).toContain('{{count}}');
    expect(az.tasks.dialog.mediaLimit).toContain('{{count}}');
    for (const s of ['waiting', 'uploading', 'done', 'failed', 'refused'] as const) expect(az.tasks.dialog.fileStates[s], s).toBeTypeOf('string');
    expect(az.tasks.dialog.uploadClock).toBe('Kompüterin saatını yoxlayın.');
    expect(az.tasks.dialog.uploadLimit).toBe('Təlimat faylları limiti dolub ({{count}}).');
    expect(az.tasks.drawer.submission).toContain('{{n}}');
    expect(az.tasks.drawer.evidenceValue).toContain('{{photo}}');
    expect(az.tasks.problems.create).toBe('Tapşırıq yarat');
    // Part 1's keys are untouched.
    expect(az.tasks.flags.overdue).toBe('Gecikib');
    expect(az.tasks.statuses.awaiting_review).toBe('Yoxlamada');
  });
});
