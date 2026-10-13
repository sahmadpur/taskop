import { isProblemType, type NotificationTargetKind, type NotificationType } from '@taskop/contracts';
import type { MailMessage } from '../mail/mailer';
import type { NotificationTarget, OccurrenceTarget, ProblemTarget, TaskTarget } from './notification-targets';

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

const OCCURRENCE_TEXTS: Record<'checklist.available' | 'checklist.due_soon' | 'checklist.overdue' | 'checklist.missed', [string, (o: OccurrenceTarget) => string]> = {
  'checklist.available': ['Checklist başladı', (o) => `${place(o)}. Son vaxt: ${time(o.dueAt, o.timezone)}.`],
  'checklist.due_soon': ['Checklistin vaxtı yaxınlaşır', (o) => `${place(o)}. ${time(o.dueAt, o.timezone)}-dək tamamlayın.`],
  'checklist.overdue': ['Checklist gecikir', (o) => `${place(o)}. Son vaxt ${time(o.dueAt, o.timezone)} idi (${day(o.localDate)}).`],
  'checklist.missed': ['Checklist icra olunmadı', (o) => `${place(o)}, ${day(o.localDate)}.`],
};

const TASK_TITLES: Record<'task.assigned' | 'task.submitted' | 'task.rejected' | 'task.completed' | 'task.overdue' | 'task.cancelled', string> = {
  'task.assigned': 'Yeni tapşırıq',
  'task.submitted': 'Tapşırıq yoxlamaya göndərildi',
  'task.rejected': 'Tapşırıq geri qaytarıldı',
  'task.completed': 'Tapşırıq tamamlandı',
  'task.overdue': 'Tapşırıq gecikir',
  'task.cancelled': 'Tapşırıq ləğv edildi',
};

const taskBody = (type: keyof typeof TASK_TITLES, t: TaskTarget) => {
  if (type === 'task.assigned' && t.dueAt) return `${t.title}. Son vaxt: ${dayTime(t.dueAt, t.timezone)}.`;
  if (type === 'task.overdue' && t.dueAt) return `${t.title}. Son vaxt ${dayTime(t.dueAt, t.timezone)} idi.`;
  return t.title;
};

/** Spec §6.1 step 4: the Azerbaijani title and body, rendered once at fan-out. */
export function renderNotification(type: NotificationType, target: NotificationTarget): RenderedNotification {
  switch (target.kind) {
    case 'manual':
      return { title: target.title, body: target.body, ...nowhere };
    case 'assignment':
      return { title: 'Yeni checklist təyin edildi', body: `${target.checklistName} — ${target.siteName}`, ...nowhere };
    case 'occurrence': {
      const [title, body] = OCCURRENCE_TEXTS[type as keyof typeof OCCURRENCE_TEXTS];
      return { title, body: body(target), ...onOccurrence(target) };
    }
    case 'problem':
      return { title: type === 'problem.critical' ? 'Kritik problem!' : 'Yeni problem', body: problemBody(target), ...onOccurrence(target.occurrence) };
    case 'task': {
      const t = type as keyof typeof TASK_TITLES;
      return { title: TASK_TITLES[t], body: taskBody(t, target), ...onTask(target) };
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
