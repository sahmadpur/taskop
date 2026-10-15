import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  AUDIT_FLOW_AUDIT_ACTIONS,
  AUDIT_ISSUE_CODES,
  AUDIT_QUEUES,
  AUDIT_REPORT_STATUSES,
  AUDIT_RESULT_FILTERS,
  AUDIT_RESULTS,
  AUDIT_STATUSES,
  AUDIT_VERDICTS,
  CANCEL_REASON_CODES,
  CLAIM_REJECTION_REASONS,
  CORRECTION_ISSUE_CODES,
  CORRECTION_KINDS,
  DELIVERY_STATUSES,
  describeSchedule,
  DIRECT_AUDIENCES,
  EXECUTION_ISSUE_CODES,
  EVIDENCE_LEVELS,
  EXECUTION_STATES,
  ErrorCode,
  ISSUE_CODES,
  isAuditType,
  ITEM_TYPES,
  MEDIA_KINDS,
  MEDIA_SOURCES,
  MISSING_KINDS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_ISSUE_CODES,
  NOTIFICATION_TYPES,
  OCCURRENCE_STATUSES,
  PERIOD_PRESETS,
  PERMISSION_GROUPS,
  PREVIEW_WARNINGS,
  PROBLEM_RESOLUTIONS,
  PROBLEM_SEVERITIES,
  PROBLEM_SOURCES,
  REPORT_EXPORT_KINDS,
  REPORT_ISSUE_CODES,
  REPORT_KINDS,
  RUN_BUCKETS,
  RUN_AUDIT_STATES,
  RUN_COUNT_KEYS,
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
import { az, formatDate, formatDateTime, interpolate } from './index.js';

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
    expect(az.mobile.checklists.sections).toEqual({
      rework: 'Düzəliş tələb olunur',
      now: 'İndi',
      inProgress: 'Davam edən',
      upcoming: 'Gələcək',
      done: 'Bitmiş',
    });
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

describe('notification translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every type, group, audience, channel, delivery status and issue', () => {
    for (const ty of NOTIFICATION_TYPES) expect(az.notifications.types[ty], ty).toBeTypeOf('string');
    for (const g of NOTIFICATION_GROUPS) expect(az.notifications.groups[g], g).toBeTypeOf('string');
    for (const a of DIRECT_AUDIENCES) expect(az.notifications.audiences[a], a).toBeTypeOf('string');
    for (const c of ['inApp', 'push', 'email'] as const) expect(az.notifications.channels[c], c).toBeTypeOf('string');
    for (const s of DELIVERY_STATUSES) expect(az.notifications.deliveryStatuses[s], s).toBeTypeOf('string');
    for (const code of NOTIFICATION_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
  });

  it('has no labels for types or statuses that do not exist', () => {
    expect(Object.keys(az.notifications.types).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(Object.keys(az.notifications.deliveryStatuses).sort()).toEqual([...DELIVERY_STATUSES].sort());
    expect(Object.keys(az.notifications.issues).sort()).toEqual(NOTIFICATION_ISSUE_CODES.map((c) => c.split('.').pop()).sort());
  });

  it('keeps the interpolation placeholder in the lead-time label', () => {
    expect(az.notifications.leadMinutes).toContain('{{count}}');
    expect(az.notifications.leadMinutes.replace('{{count}}', '15')).toBe('15 dəq əvvəl');
  });

  it('uses the agreed wording and registers the nav, audit and role labels', () => {
    expect(az.notifications.types['checklist.due_soon']).toBe('Checklistin vaxtı yaxınlaşır');
    expect(az.notifications.types.manual).toBe('Admin mesajı');
    expect(az.notifications.groups).toEqual({ checklist: 'Checklistlər', problem: 'Problemlər', task: 'Tapşırıqlar', audit: 'Audit və düzəlişlər' });
    expect(az.notifications.audiences).toEqual({ assignees: 'İcraçılar', creator: 'Yaradan' });
    expect(az.notifications.channels).toEqual({ inApp: 'Tətbiqdə', push: 'Push', email: 'E-poçt' });
    expect(az.notifications.title).toBe('Bildirişlər');
    expect(az.notifications.markAllRead).toBe('Hamısını oxunmuş et');
    expect(az.notifications.empty).toBe('Bildiriş yoxdur');
    expect(az.nav.notifications).toBe('Bildirişlər');
    expect(az.nav.messages).toBe('Mesajlar');
    expect(az.roles.groups.notifications).toBe('Bildirişlər');
    expect(az.roles.keys.notifications_manage).toBeTypeOf('string');
    expect(az.roles.keys.notifications_send).toBeTypeOf('string');
    expect(az.audit.entityTypes.notification_rule).toBe('Bildiriş qaydası');
    expect(az.audit.entityTypes.notification_message).toBe('Bildiriş mesajı');
  });
});

describe('mobile notification translations', () => {
  it('labels the bell, the inbox and the profile settings', () => {
    expect(az.mobile.notifications.bell.replace('{{count}}', '3')).toBe('Bildirişlər, 3 oxunmamış');
    for (const k of ['channel', 'unread', 'online'] as const) expect(az.mobile.notifications[k], k).toBeTypeOf('string');
    for (const k of ['email', 'noEmail', 'online', 'push', 'deniedHint', 'openSettings'] as const) {
      expect(az.mobile.notifications.profile[k], k).toBeTypeOf('string');
    }
    expect(Object.keys(az.mobile.notifications.profile.pushStates).sort()).toEqual(['denied', 'granted', 'unavailable', 'undetermined']);
  });

  it('shares the inbox wording with the web (Part 1)', () => {
    expect(az.notifications.title).toBe('Bildirişlər');
    expect(az.notifications.markAllRead).toBe('Hamısını oxunmuş et');
    expect(az.notifications.empty).toBe('Bildiriş yoxdur');
  });
});

describe('notification web translations', () => {
  const n = () => az.notifications;

  it('has the strings the bell, the inbox, the rules tab, the messages page and the preferences dialog use', () => {
    for (const k of ['unread', 'viewAll'] as const) expect(n().bell[k], `bell.${k}`).toBeTypeOf('string');
    for (const k of ['unread', 'unreadOnly', 'emptyUnread', 'more'] as const) expect(n().inbox[k], `inbox.${k}`).toBeTypeOf('string');
    for (const k of ['intro', 'control', 'customized', 'reset', 'resetDone', 'noRoles', 'rolesCount', 'rolesUnavailable'] as const) {
      expect(n().rules[k], `rules.${k}`).toBeTypeOf('string');
    }
    for (const k of ['type', 'enabled', 'roles', 'leadTime'] as const) expect(n().rules.columns[k], `rules.columns.${k}`).toBeTypeOf('string');
    for (const k of [
      'compose', 'recipients', 'recipientsPlaceholder', 'people', 'teams', 'sites', 'members', 'chosen', 'remove', 'targetLimit', 'refine', 'sitesCapped',
      'titleLabel', 'bodyLabel', 'counter', 'email', 'send', 'confirmTitle', 'confirm', 'sent', 'history', 'emptyHistory', 'more',
      'processing', 'notRequested', 'detailTitle', 'sentBy', 'targets', 'totals', 'recipient', 'notRead', 'devices', 'noDevice',
      'noRecipientsYet',
    ] as const) {
      expect(n().messages[k], `messages.${k}`).toBeTypeOf('string');
    }
    for (const k of ['sentAt', 'sender', 'title', 'recipients', 'read', 'push', 'email'] as const) {
      expect(n().messages.columns[k], `messages.columns.${k}`).toBeTypeOf('string');
    }
    for (const k of ['menu', 'title', 'description', 'email', 'noEmail', 'saved'] as const) {
      expect(n().preferences[k], `preferences.${k}`).toBeTypeOf('string');
    }
  });

  it('keeps the interpolation placeholders the components pass', () => {
    expect(n().bell.unread).toContain('{{count}}');
    expect(n().rules.control).toContain('{{type}}');
    expect(n().rules.control).toContain('{{control}}');
    expect(n().rules.rolesCount).toContain('{{count}}');
    expect(n().messages.members).toContain('{{count}}');
    expect(n().messages.remove).toContain('{{name}}');
    expect(n().messages.targetLimit).toContain('{{count}}');
    expect(n().messages.sitesCapped).toContain('{{count}}');
    expect(n().messages.counter).toContain('{{count}}');
    expect(n().messages.counter).toContain('{{max}}');
    expect(n().messages.confirm).toContain('{{count}}');
    expect(n().messages.sentBy).toContain('{{name}}');
    expect(n().messages.sentBy).toContain('{{time}}');
    expect(n().messages.totals).toContain('{{recipients}}');
    expect(n().messages.totals).toContain('{{read}}');
    expect(n().messages.devices).toContain('{{count}}');
  });

  it('leaves the existing notification and nav keys untouched', () => {
    expect(n().title).toBe('Bildirişlər');
    expect(n().markAllRead).toBe('Hamısını oxunmuş et');
    expect(n().empty).toBe('Bildiriş yoxdur');
    expect(n().deliveryStatuses.delivered).toBe('Çatdırıldı');
    expect(n().deliveryStatuses.failed).toBe('Alınmadı');
    expect(az.nav.messages).toBe('Mesajlar');
  });
});

describe('report translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every count, bucket, period, tab, export title and issue', () => {
    for (const k of RUN_COUNT_KEYS) expect(az.reports.counts[k], k).toBeTypeOf('string');
    for (const b of RUN_BUCKETS) expect(az.reports.buckets[b], b).toBeTypeOf('string');
    for (const p of PERIOD_PRESETS) expect(az.reports.periods[p], p).toBeTypeOf('string');
    expect(az.reports.periods.custom).toBeTypeOf('string');
    for (const k of REPORT_KINDS) expect(az.reports.tabs[k], k).toBeTypeOf('string');
    for (const k of REPORT_EXPORT_KINDS) expect(az.reports.titles[k], k).toBeTypeOf('string');
    for (const code of REPORT_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
  });

  it('uses the agreed wording and registers the nav, audit, role and error labels', () => {
    expect(az.nav.reports).toBe('Hesabatlar');
    expect(az.reports.title).toBe('Hesabatlar');
    expect(az.reports.measures.completionPercent).toBe('Tamamlanma faizi');
    expect(az.reports.export.thisTable).toBe('Bu cədvəl');
    expect(az.reports.export.fullReport).toBe('Tam hesabat');
    expect(az.reports.employees.unassigned).toBe('Təyin edilməyib');
    expect(az.reports.periods.today).toBe('Bu gün');
    expect(az.roles.groups.reports).toBe('Hesabatlar');
    expect(az.audit.entityTypes.report).toBe('Hesabat');
    for (const s of [az.errors.REPORT_TOO_LARGE, az.reports.export.tooLarge]) {
      expect(s).toContain('{{rows}}');
      expect(s).toContain('{{limit}}');
    }
    expect(az.reports.pdf.page).toBe('Səhifə {{page}} / {{pages}}');
  });
});

describe('mobile team translations', () => {
  it('labels the Team tab, its periods, its offline state, its rows and the run screen', () => {
    expect(az.mobile.tabs.team).toBe('Komanda');
    expect(az.mobile.team.title).toBe('Komanda');
    expect(az.mobile.team.offline).toBe('Komandanı görmək üçün internetə qoşulun');
    expect(az.mobile.team.periods).toEqual({ today: 'Bu gün', last_7: '7 gün', last_30: '30 gün' });
    for (const p of Object.keys(az.mobile.team.periods)) expect(PERIOD_PRESETS, p).toContain(p);
    expect(az.mobile.team.due.replace('{{time}}', '10:00')).toBe('Son vaxt: 10:00');
    expect(az.mobile.team.problems.replace('{{count}}', '2')).toBe('Problem: 2');
    expect(az.mobile.team.critical.replace('{{count}}', '1')).toBe('Kritik: 1');
    expect(az.mobile.team.run.notExecuted).toBe('Hələ icra edilməyib');
    for (const k of ['title', 'answers', 'cancelReason'] as const) expect(az.mobile.team.run[k], k).toBeTypeOf('string');
  });

  it('shares the report wording with the web (Part 1)', () => {
    expect(az.reports.notCompleted).toBe('Tamamlanmayıb');
    expect(az.reports.buckets).toMatchObject({ all: 'Hamısı', overdue: 'Gecikmiş', partial: 'Yarımçıq', missed: 'Buraxılmış', problems: 'Problemli' });
    expect(az.reports.measures.completionPercent).toBe('Tamamlanma faizi');
    expect(az.errors.REPORT_TIMEOUT).toBeTypeOf('string');
  });
});

describe('report web translations', () => {
  it('has the strings the filter bar, the tiles, the trend, the dashboard and the report tables use', () => {
    expect(az.reports.range.label).toBe('{{from}} – {{to}}');
    expect(az.reports.range.incomplete).toBe('Başlanğıc və son tarixi seçin.');
    expect(az.reports.picker.unknown).toBeTypeOf('string');
    expect(az.reports.picker.unknownEmployee).toBeTypeOf('string');
    expect(az.reports.tiles.link).toBe('{{label}}: {{value}}');
    expect(az.reports.chart.table).toBe('Gündəlik icra cədvəli');
    expect(az.reports.live.refresh).toBe('Yenilə');
    expect(az.reports.live.updatedAt).toBe('Son yenilənmə: {{time}}');
    expect(az.reports.attention.title).toBe('Diqqət tələb edir');
    expect(az.reports.attention.overdueNow).toBe('Hazırda gecikən icralar');
    expect(az.reports.attention.critical).toBe('Kritik problemlər');
    for (const k of ['noneOverdue', 'noneCritical'] as const) expect(az.reports.attention[k], k).toBeTypeOf('string');
    expect(az.reports.table.more).toBe('Daha çox göstər');
    expect(az.reports.table.sort).toBe('{{column}} üzrə sırala');
    expect(az.reports.table.openTask).toBe('Tapşırığı aç');
    expect(az.reports.table.receivedAt).toBe('Serverə çatıb: {{time}}');
    // Part 1's keys are untouched.
    expect(az.reports.dashboard).toBe('İdarə paneli');
    expect(az.reports.export.thisTable).toBe('Bu cədvəl');
    expect(az.reports.measures.completionHint).toBe('Vaxtı çatmış icralardan tamamlananların payı');
    expect(az.nav.reports).toBe('Hesabatlar');
  });
});

describe('audit and correction translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every audit status, result, verdict, report status, queue, run audit state, correction kind and issue', () => {
    for (const s of AUDIT_STATUSES) expect(az.audits.statuses[s], s).toBeTypeOf('string');
    for (const r of AUDIT_RESULTS) expect(az.audits.results[r], r).toBeTypeOf('string');
    for (const v of AUDIT_VERDICTS) expect(az.audits.verdicts[v], v).toBeTypeOf('string');
    expect(az.audits.verdicts.unreviewed).toBeTypeOf('string');
    for (const s of AUDIT_REPORT_STATUSES) expect(az.audits.reportStatuses[s], s).toBeTypeOf('string');
    for (const q of AUDIT_QUEUES) expect(az.audits.queues[q], q).toBeTypeOf('string');
    for (const s of RUN_AUDIT_STATES) expect(az.audits.runAuditStates[s], s).toBeTypeOf('string');
    for (const k of CORRECTION_KINDS) expect(az.corrections.kinds[k], k).toBeTypeOf('string');
    for (const code of [...AUDIT_ISSUE_CODES, ...CORRECTION_ISSUE_CODES]) expect(lookup(code), code).toBeTypeOf('string');
    expect(Object.keys(az.audits.issues).sort()).toEqual(AUDIT_ISSUE_CODES.map((c) => c.split('.').pop()).sort());
    expect(Object.keys(az.corrections.issues).sort()).toEqual(CORRECTION_ISSUE_CODES.map((c) => c.split('.').pop()).sort());
  });

  it('has the actions, fields, PDF and e-mail texts with their placeholders', () => {
    for (const k of ['start', 'open', 'finish', 'cancel', 'approve', 'reject', 'clearVerdict', 'downloadReport', 'resendReport', 'retryReport'] as const) {
      expect(az.audits.actions[k], k).toBeTypeOf('string');
    }
    for (const k of ['result', 'comment', 'extraEmails', 'reportEmails', 'requiresAudit', 'cancelReason', 'auditor', 'startedAt', 'finishedAt', 'recipients', 'sentAt'] as const) {
      expect(az.audits.fields[k], k).toBeTypeOf('string');
    }
    for (const k of [
      'title', 'run', 'executor', 'window', 'startedAt', 'completedAt', 'syncedAt', 'auditor', 'finishedAt', 'result', 'auditScore', 'runScore', 'originalScore',
      'comment', 'item', 'answer', 'verdict', 'original', 'correctedBy', 'problem', 'videos', 'morePhotos', 'generatedAt', 'auditId', 'page',
      'checklist', 'site', 'version', 'photos', 'noAnswer', 'none',
    ] as const) {
      expect(az.audits.report[k], k).toBeTypeOf('string');
    }
    expect(az.audits.report.videos).toContain('{{count}}');
    expect(az.audits.report.morePhotos).toContain('{{count}}');
    expect(az.audits.report.page).toBe('Səhifə {{page}} / {{pages}}');
    expect(az.audits.progress).toContain('{{reviewed}}');
    for (const p of ['{{checklist}}', '{{site}}', '{{date}}']) expect(az.audits.email.subject, p).toContain(p);
    for (const p of ['{{checklist}}', '{{site}}', '{{date}}', '{{result}}', '{{auditor}}']) expect(az.audits.email.body, p).toContain(p);
    for (const k of ['correct', 'sendBack', 'withdraw', 'resubmit'] as const) expect(az.corrections.actions[k], k).toBeTypeOf('string');
    for (const k of ['reason', 'itemComment', 'dueAt', 'items'] as const) expect(az.corrections.fields[k], k).toBeTypeOf('string');
    expect(az.corrections.round).toContain('{{round}}');
    expect(az.corrections.dueAt).toContain('{{date}}');
  });

  it('uses the FR-19.15 wording and the agreed labels', () => {
    expect(az.scheduling.statuses.correction_required).toBe('Düzəliş tələb olunur');
    expect(az.corrections.reworkBanner).toBe('Düzəliş tələb olunur');
    expect(az.executions.states.rework).toBe('Düzəlişdə');
    expect(az.scheduling.statuses.audit_pending).toBe('Audit gözləyir');
    expect(az.scheduling.statuses.audited).toBe('Audit olunub');
    expect(az.audits.title).toBe('Auditlər');
    expect(az.nav.audits).toBe('Auditlər');
    expect(az.corrections.title).toBe('Düzəlişlər');
    expect(az.corrections.kinds).toEqual({ manual: 'Rəhbər düzəlişi', rework: 'İcraçı düzəlişi' });
    expect(az.roles.groups.executions).toBeTypeOf('string');
    expect(az.roles.groups.audits).toBeTypeOf('string');
    expect(az.roles.keys.executions_correct).toBeTypeOf('string');
    expect(az.roles.keys.audits_perform).toBeTypeOf('string');
    expect(az.audit.entityTypes.audit).toBe('Audit');
    expect(az.audit.entityTypes.execution).toBe('İcra');
    for (const a of AUDIT_FLOW_AUDIT_ACTIONS) expect(az.audit.actions[a], a).toBeTypeOf('string');
  });

  it('has the notification labels, filters and templates of the three audit types', () => {
    for (const f of AUDIT_RESULT_FILTERS) expect(az.notifications.resultFilters[f], f).toBeTypeOf('string');
    for (const ty of NOTIFICATION_TYPES.filter(isAuditType)) {
      const tpl = az.notifications.templates[ty as keyof typeof az.notifications.templates];
      expect(tpl.title, ty).toBeTypeOf('string');
      expect(tpl.body, ty).toContain('{{checklist}}');
    }
    expect(az.notifications.templates['run.correction_required'].body).toContain('{{count}}');
    expect(az.notifications.templates['run.correction_required'].due).toContain('{{date}}');
    expect(az.notifications.templates['run.resubmitted'].body).toContain('{{executor}}');
    expect(az.notifications.templates['audit.finished'].body).toContain('{{result}}');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(interpolate('{{a}} və {{b}}', { a: 1, b: 'iki' })).toBe('1 və iki');
    expect(interpolate('{{a}} {{x}}', { a: 'A' })).toBe('A {{x}}');
  });
});

describe('mobile audit and correction translations', () => {
  it('labels the rework flow on the worker’s phone', () => {
    expect(az.mobile.checklists.sections.rework).toBe('Düzəliş tələb olunur');
    expect(az.mobile.rework.items.replace('{{count}}', '2')).toBe('2 bənd düzəliş tələb edir');
    expect(az.mobile.rework.fix).toBe('Düzəliş et');
    expect(az.mobile.rework.managerComment.replace('{{comment}}', 'Yenidən ölçün')).toBe('Rəhbərin şərhi: Yenidən ölçün');
    expect(az.mobile.rework.progress.replace('{{done}}', '1').replace('{{total}}', '2')).toBe('1/2 qaytarılan bənd hazırdır');
    expect(az.mobile.rework.resubmit).toBe('Yenidən təqdim et');
    expect(az.mobile.rework.resubmitted).toBe('Düzəlişlər göndərildi.');
    expect(az.mobile.rework.newQuestion).toBe('Yeni sual');
    expect(az.mobile.sync.kinds.resubmit).toBe('Yenidən təqdim');
    for (const k of ['notFlagged', 'title', 'flaggedTitle', 'ready', 'sentBanner'] as const) expect(az.mobile.rework[k], k).toBeTypeOf('string');
  });

  it('labels the Team tab’s audit, correction, send-back and history screens', () => {
    expect(az.mobile.team.correct.next).toBe('Davam et');
    expect(az.mobile.team.correct.noChanges).toBe('Heç bir cavab dəyişməyib.');
    expect(az.mobile.team.sendBack.title).toBe('İcraçıya qaytar');
    expect(az.mobile.team.sendBack.noItems).toBe('Ən azı bir bənd seçin.');
    expect(az.mobile.team.history.requested.replace('{{name}}', 'Leyla').replace('{{count}}', '2')).toBe('Leyla 2 bəndi qaytarıb');
    expect(az.mobile.team.audit.reportTo.replace('{{emails}}', 'a@b.az')).toBe('Hesabat göndəriləcək: a@b.az');
    for (const group of ['audit', 'correct', 'sendBack', 'history'] as const) {
      for (const [k, v] of Object.entries(az.mobile.team[group])) expect(v, `${group}.${k}`).toBeTypeOf('string');
    }
  });

  it('uses Part 1’s wording for the new statuses', () => {
    expect(az.scheduling.statuses.correction_required).toBe('Düzəliş tələb olunur');
    expect(az.executions.states.rework).toBe('Düzəlişdə');
  });
});

describe('audit and correction web translations', () => {
  it('nests the web strings under az.audits.web and az.corrections.web, beside Part 1 keys', () => {
    expect(az.audits.web.page.columns.executor).toBe('İcraçı');
    expect(az.audits.web.page.empty.waiting).toBe('Audit gözləyən icra yoxdur.');
    expect(az.audits.web.page.range.incomplete).toBe('Başlanğıc və son tarixi birlikdə seçin.');
    expect(az.audits.web.screen.items).toBe('Bəndlər');
    expect(az.audits.web.screen.keyboard).toBe('Klaviatura: ↑/↓ — bənd seçimi, A — təsdiqlə, R — rədd et');
    expect(az.audits.web.screen.missing).toBe('{{count}} bənd hələ qiymətləndirilməyib.');
    expect(az.audits.web.finish.title).toBe('Auditi bitir');
    expect(az.audits.web.cancel.title).toBe('Auditi ləğv et');
    expect(az.audits.web.report.preparing).toBe('Hesabat hazırlanır…');
    expect(az.audits.web.report.checkAgain).toBe('Yenidən yoxla');
    expect(az.audits.web.emails.remove).toBe('Sil: {{email}}');
    expect(az.audits.web.emails.tooMany).toBe('Ən çox {{max}} ünvan əlavə etmək olar.');
    expect(az.audits.web.settings.title).toBe('Audit');
    expect(az.audits.web.resultFilter).toBe('Audit nəticəsi');
    expect(az.corrections.web.edit.save).toBe('Düzəlişləri yadda saxla');
    expect(az.corrections.web.edit.reasonTitle).toBe('Düzəlişin səbəbi');
    expect(az.corrections.web.sendBack.title).toBe('İcranı düzəlişə qaytar');
    expect(az.corrections.web.sendBack.comment).toBe('{{item}} — şərh');
    expect(az.corrections.web.withdraw.title).toBe('Geri qaytarmanı ləğv et');
    expect(az.corrections.web.timeline.sentBack).toBe('{{name}} icranı düzəlişə qaytardı');
    expect(az.corrections.web.score.original).toBe('İlkin bal: {{value}}');
    expect(az.corrections.web.showCleared).toBe('Aradan qaldırılanları göstər');
    // Part 1's keys are untouched.
    expect(az.audits.paused).toBe('İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir');
    expect(az.corrections.original).toBe('İlkin');
    expect(az.corrections.emptyAnswer).toBe('Cavab yoxdur');
    expect(az.nav.audits).toBe('Auditlər');
  });
});
