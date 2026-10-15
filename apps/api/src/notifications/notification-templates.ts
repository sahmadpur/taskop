import { isProblemType, type NotificationTargetKind, type NotificationType } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';
import type { MailMessage } from '../mail/mailer';
import type { NotificationTarget, OccurrenceTarget, ProblemTarget, RunTarget, TaskTarget } from './notification-targets';

/** What one inbox row stores and every channel sends (spec §5 `notifications`). */
export interface RenderedNotification {
  title: string;
  body: string;
  targetKind: NotificationTargetKind;
  targetId: string | null;
  targetDate: string | null;
}

const NOTE_MAX = 200;

/** HH:mm, 24-hour, in the tenant's timezone. */
const time = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/** DD.MM.YYYY from a YYYY-MM-DD local date. */
const day = (localDate: string) => localDate.split('-').reverse().join('.');

/** DD.MM.YYYY HH:mm of an instant, in the tenant's timezone. */
const dayTime = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${day(parts)} ${time(d, tz)}`;
};

const cut = (s: string) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX)}…` : s);

const onOccurrence = (o: OccurrenceTarget) => ({ targetKind: 'occurrence' as const, targetId: o.occurrenceId, targetDate: o.localDate });
const onTask = (t: TaskTarget) => ({ targetKind: 'task' as const, targetId: t.taskId, targetDate: null });
const nowhere = { targetKind: 'none' as const, targetId: null, targetDate: null };

const place = (o: OccurrenceTarget) => `${o.checklistName} — ${o.siteName}`;
const problemBody = (p: ProblemTarget) => `${p.occurrence.siteName}, ${p.occurrence.checklistName}${p.note ? `: ${cut(p.note)}` : ''}`;

type OccurrenceType = Exclude<Extract<NotificationType, `checklist.${string}`>, 'checklist.assigned'>;
type ProblemType = Extract<NotificationType, `problem.${string}`>;
type TaskType = Extract<NotificationType, `task.${string}`>;

// Each table is total over its slice of NotificationType: a new type that fits a slice fails typecheck until it has a text.
const OCCURRENCE_TEXTS = {
  'checklist.available': ['Checklist başladı', (o) => `${place(o)}. Son vaxt: ${time(o.dueAt, o.timezone)}.`],
  'checklist.due_soon': ['Checklistin vaxtı yaxınlaşır', (o) => `${place(o)}. ${time(o.dueAt, o.timezone)}-dək tamamlayın.`],
  'checklist.overdue': ['Checklist gecikir', (o) => `${place(o)}. Son vaxt ${time(o.dueAt, o.timezone)} idi (${day(o.localDate)}).`],
  'checklist.missed': ['Checklist icra olunmadı', (o) => `${place(o)}, ${day(o.localDate)}.`],
} satisfies Record<OccurrenceType, [string, (o: OccurrenceTarget) => string]>;

const PROBLEM_TITLES = {
  'problem.recorded': 'Yeni problem',
  'problem.critical': 'Kritik problem!',
} satisfies Record<ProblemType, string>;

const TASK_TITLES = {
  'task.assigned': 'Yeni tapşırıq',
  'task.submitted': 'Tapşırıq yoxlamaya göndərildi',
  'task.rejected': 'Tapşırıq geri qaytarıldı',
  'task.completed': 'Tapşırıq tamamlandı',
  'task.overdue': 'Tapşırıq gecikir',
  'task.cancelled': 'Tapşırıq ləğv edildi',
} satisfies Record<TaskType, string>;

const taskBody = (type: NotificationType, t: TaskTarget) => {
  if (type === 'task.assigned' && t.dueAt) return `${t.title}. Son vaxt: ${dayTime(t.dueAt, t.timezone)}.`;
  if (type === 'task.overdue' && t.dueAt) return `${t.title}. Son vaxt ${dayTime(t.dueAt, t.timezone)} idi.`;
  return t.title;
};

/** Looks a type up in a table that covers only some types; undefined when the type does not belong to it. */
const entry = <V>(table: Partial<Record<NotificationType, V>>, type: NotificationType): V | undefined =>
  Object.hasOwn(table, type) ? table[type] : undefined;

const mismatch = (type: NotificationType, target: NotificationTarget) =>
  new Error(`Notification type ${type} cannot be rendered for a ${target.kind} target`);

/** SP8 spec §7.1: the texts live in @taskop/i18n (az.notifications.templates). */
function runText(type: NotificationType, r: RunTarget): { title: string; body: string } | null {
  const T = az.notifications.templates;
  const place = { checklist: r.occurrence.checklistName, site: r.occurrence.siteName };
  switch (type) {
    case 'run.correction_required': {
      const body = interpolate(T['run.correction_required'].body, { ...place, count: r.flaggedCount });
      const due = r.dueAt ? ` ${interpolate(T['run.correction_required'].due, { date: dayTime(r.dueAt, r.occurrence.timezone) })}` : '';
      return { title: T['run.correction_required'].title, body: `${body}${due}` };
    }
    case 'run.resubmitted':
      return { title: T['run.resubmitted'].title, body: interpolate(T['run.resubmitted'].body, { ...place, executor: r.executorName, round: r.round ?? 1 }) };
    case 'audit.finished':
      return {
        title: T['audit.finished'].title,
        body: interpolate(T['audit.finished'].body, {
          ...place,
          result: r.auditResult ? az.audits.results[r.auditResult] : az.audits.report.none,
          // The template carries no % sign of its own.
          percent: r.auditPercent === null ? az.audits.report.none : `${r.auditPercent}%`,
        }),
      };
    default:
      return null;
  }
}

/** Spec §6.1 step 4: the Azerbaijani title and body, rendered once at fan-out. */
export function renderNotification(type: NotificationType, target: NotificationTarget): RenderedNotification {
  switch (target.kind) {
    case 'manual':
      if (type !== 'manual') throw mismatch(type, target);
      return { title: target.title, body: target.body, ...nowhere };
    case 'assignment':
      if (type !== 'checklist.assigned') throw mismatch(type, target);
      return { title: 'Yeni checklist təyin edildi', body: `${target.checklistName} — ${target.siteName}`, ...nowhere };
    case 'occurrence': {
      const texts = entry<[string, (o: OccurrenceTarget) => string]>(OCCURRENCE_TEXTS, type);
      if (!texts) throw mismatch(type, target);
      return { title: texts[0], body: texts[1](target), ...onOccurrence(target) };
    }
    case 'problem': {
      const title = entry<string>(PROBLEM_TITLES, type);
      if (title === undefined) throw mismatch(type, target);
      return { title, body: problemBody(target), ...onOccurrence(target.occurrence) };
    }
    case 'task': {
      const title = entry<string>(TASK_TITLES, type);
      if (title === undefined) throw mismatch(type, target);
      return { title, body: taskBody(type, target), ...onTask(target) };
    }
    case 'run': {
      const text = runText(type, target);
      if (!text) throw mismatch(type, target);
      return { ...text, ...onOccurrence(target.occurrence) };
    }
    default: {
      const unhandled: never = target;
      throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The web page a notification opens (spec §8), as an absolute link for email. */
export function notificationLink(
  webUrl: string,
  n: { type: NotificationType; targetKind: NotificationTargetKind; targetId: string | null; targetDate: string | null },
): string {
  if (n.targetKind === 'occurrence' && n.targetId && n.targetDate) {
    return `${webUrl}/schedule?date=${n.targetDate}&occurrence=${n.targetId}${isProblemType(n.type) ? '&tab=execution' : ''}`;
  }
  if (n.targetKind === 'task' && n.targetId) return `${webUrl}/tasks?task=${n.targetId}`;
  return `${webUrl}/notifications`;
}

/** Plain-text email (spec §6.1 step 5), next to mail/templates.ts in style. */
export function notificationMail(p: { to: string; webUrl: string; notification: RenderedNotification & { type: NotificationType } }): MailMessage {
  const n = p.notification;
  return {
    to: p.to,
    subject: n.title,
    text: `${n.body}\n\nAçmaq üçün: ${notificationLink(p.webUrl, n)}\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
  };
}
