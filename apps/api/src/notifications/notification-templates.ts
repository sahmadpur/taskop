import { isProblemType, type NotificationTargetKind, type NotificationType } from '@taskop/contracts';
import { interpolate, type Language, translationsFor } from '@taskop/i18n';
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

type OccurrenceType = Exclude<Extract<NotificationType, `checklist.${string}`>, 'checklist.assigned'>;
type ProblemType = Extract<NotificationType, `problem.${string}`>;
type TaskType = Extract<NotificationType, `task.${string}`>;
type Templates = ReturnType<typeof translationsFor>['notifications']['templates'];

const mismatch = (type: NotificationType, target: NotificationTarget) =>
  new Error(`Notification type ${type} cannot be rendered for a ${target.kind} target`);

const OCCURRENCE_TYPES: ReadonlySet<NotificationType> = new Set<OccurrenceType>(['checklist.available', 'checklist.due_soon', 'checklist.overdue', 'checklist.missed']);
const PROBLEM_TYPES: ReadonlySet<NotificationType> = new Set<ProblemType>(['problem.recorded', 'problem.critical']);
const TASK_TYPES: ReadonlySet<NotificationType> = new Set<TaskType>(['task.assigned', 'task.submitted', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled']);

const occurrenceText = (T: Templates, type: NotificationType, o: OccurrenceTarget): { title: string; body: string } | null => {
  if (!OCCURRENCE_TYPES.has(type)) return null;
  const t = T[type as OccurrenceType];
  return { title: t.title, body: interpolate(t.body, { place: place(o), time: time(o.dueAt, o.timezone), date: day(o.localDate) }) };
};

const problemText = (T: Templates, type: NotificationType, p: ProblemTarget): { title: string; body: string } | null => {
  if (!PROBLEM_TYPES.has(type)) return null;
  const t = T[type as ProblemType];
  return { title: t.title, body: `${interpolate(t.body, { site: p.occurrence.siteName, checklist: p.occurrence.checklistName })}${p.note ? `: ${cut(p.note)}` : ''}` };
};

const taskText = (T: Templates, type: NotificationType, t: TaskTarget): { title: string; body: string } | null => {
  if (!TASK_TYPES.has(type)) return null;
  const tpl = T[type as TaskType];
  const withDue = 'due' in tpl && t.dueAt ? interpolate(tpl.due, { title: t.title, date: dayTime(t.dueAt, t.timezone) }) : interpolate(tpl.body, { title: t.title });
  return { title: tpl.title, body: withDue };
};

/** SP8 spec §7.1: the texts live in @taskop/i18n (notifications.templates). */
function runText(L: ReturnType<typeof translationsFor>, type: NotificationType, r: RunTarget): { title: string; body: string } | null {
  const T = L.notifications.templates;
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
          result: r.auditResult ? L.audits.results[r.auditResult] : L.audits.report.none,
          // The template carries no % sign of its own.
          percent: r.auditPercent === null ? L.audits.report.none : `${r.auditPercent}%`,
        }),
      };
    default:
      return null;
  }
}

/** Spec §6.1 step 4: the title and body in the recipient's language, rendered at fan-out. A manual message is the sender's own words. */
export function renderNotification(type: NotificationType, target: NotificationTarget, locale: Language): RenderedNotification {
  const L = translationsFor(locale);
  const T = L.notifications.templates;
  switch (target.kind) {
    case 'manual':
      if (type !== 'manual') throw mismatch(type, target);
      return { title: target.title, body: target.body, ...nowhere };
    case 'assignment':
      if (type !== 'checklist.assigned') throw mismatch(type, target);
      return { title: T['checklist.assigned'].title, body: interpolate(T['checklist.assigned'].body, { checklist: target.checklistName, site: target.siteName }), ...nowhere };
    case 'occurrence': {
      const text = occurrenceText(T, type, target);
      if (!text) throw mismatch(type, target);
      return { ...text, ...onOccurrence(target) };
    }
    case 'problem': {
      const text = problemText(T, type, target);
      if (!text) throw mismatch(type, target);
      return { ...text, ...onOccurrence(target.occurrence) };
    }
    case 'task': {
      const text = taskText(T, type, target);
      if (!text) throw mismatch(type, target);
      return { ...text, ...onTask(target) };
    }
    case 'run': {
      const text = runText(L, type, target);
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

/** Plain-text email (spec §6.1 step 5), next to mail/templates.ts in style; the two trailing lines in the recipient's language. */
export function notificationMail(p: { to: string; webUrl: string; locale: Language; notification: RenderedNotification & { type: NotificationType } }): MailMessage {
  const n = p.notification;
  const T = translationsFor(p.locale).mail.notification;
  return {
    to: p.to,
    subject: n.title,
    text: `${n.body}\n\n${interpolate(T.open, { link: notificationLink(p.webUrl, n) })}\n\n${T.footer}`,
  };
}
