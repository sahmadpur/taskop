import { isAuditType, NOTIFICATION_TYPES, type NotificationType } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import type { AssignmentTarget, ManualTarget, OccurrenceTarget, ProblemTarget, TaskTarget } from './notification-targets';
import { notificationLink, notificationMail, renderNotification } from './notification-templates';

const OCC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const TASK = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
// 08:00–10:00 in Baku (UTC+4).
const occurrence: OccurrenceTarget = {
  kind: 'occurrence', occurrenceId: OCC, assignmentId: OCC, localDate: '2026-11-02', startsAt: new Date('2026-11-02T04:00:00Z'),
  dueAt: new Date('2026-11-02T06:00:00Z'), checklistName: 'Açılış yoxlaması', siteName: 'Filial 1', timezone: 'Asia/Baku',
};
const problem: ProblemTarget = { kind: 'problem', problemId: OCC, severity: 'critical', note: 'Kondisioner xarabdır', occurrence };
const assignment: AssignmentTarget = { kind: 'assignment', assignmentId: OCC, addedUserIds: [], checklistName: 'Açılış yoxlaması', siteName: 'Filial 1' };
const task: TaskTarget = {
  kind: 'task', taskId: TASK, title: 'Soyuducunun qapısını təmir edin', assigneeUserId: null, assigneeTeamId: null, createdByUserId: TASK,
  dueAt: new Date('2026-11-02T10:30:00Z'), timezone: 'Asia/Baku',
};
const manual: ManualTarget = { kind: 'manual', title: 'Diqqət', body: 'Sabah iclas var.', userIds: [], teamIds: [], siteIds: [], email: false, senderUserId: null };
const onOccurrence = { targetKind: 'occurrence', targetId: OCC, targetDate: '2026-11-02' } as const;
const onTask = { targetKind: 'task', targetId: TASK, targetDate: null } as const;
const nowhere = { targetKind: 'none', targetId: null, targetDate: null } as const;

describe('renderNotification', () => {
  it.each([
    ['checklist.assigned', assignment, 'Yeni checklist təyin edildi', 'Açılış yoxlaması — Filial 1', nowhere],
    ['checklist.available', occurrence, 'Checklist başladı', 'Açılış yoxlaması — Filial 1. Son vaxt: 10:00.', onOccurrence],
    ['checklist.due_soon', occurrence, 'Checklistin vaxtı yaxınlaşır', 'Açılış yoxlaması — Filial 1. 10:00-dək tamamlayın.', onOccurrence],
    ['checklist.overdue', occurrence, 'Checklist gecikir', 'Açılış yoxlaması — Filial 1. Son vaxt 10:00 idi (02.11.2026).', onOccurrence],
    ['checklist.missed', occurrence, 'Checklist icra olunmadı', 'Açılış yoxlaması — Filial 1, 02.11.2026.', onOccurrence],
    ['problem.recorded', { ...problem, severity: 'normal' }, 'Yeni problem', 'Filial 1, Açılış yoxlaması: Kondisioner xarabdır', onOccurrence],
    ['problem.critical', problem, 'Kritik problem!', 'Filial 1, Açılış yoxlaması: Kondisioner xarabdır', onOccurrence],
    ['task.assigned', task, 'Yeni tapşırıq', 'Soyuducunun qapısını təmir edin. Son vaxt: 02.11.2026 14:30.', onTask],
    ['task.submitted', task, 'Tapşırıq yoxlamaya göndərildi', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.rejected', task, 'Tapşırıq geri qaytarıldı', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.completed', task, 'Tapşırıq tamamlandı', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.overdue', task, 'Tapşırıq gecikir', 'Soyuducunun qapısını təmir edin. Son vaxt 02.11.2026 14:30 idi.', onTask],
    ['task.cancelled', task, 'Tapşırıq ləğv edildi', 'Soyuducunun qapısını təmir edin', onTask],
    ['manual', manual, 'Diqqət', 'Sabah iclas var.', nowhere],
  ] as const)('%s', (type, target, title, body, where) => {
    expect(renderNotification(type, target)).toEqual({ title, body, ...where });
  });

  it('leaves the due part out of a task without a due time, and the note out of a problem without one', () => {
    expect(renderNotification('task.assigned', { ...task, dueAt: null }).body).toBe('Soyuducunun qapısını təmir edin');
    expect(renderNotification('task.overdue', { ...task, dueAt: null }).body).toBe('Soyuducunun qapısını təmir edin');
    expect(renderNotification('problem.critical', { ...problem, note: null }).body).toBe('Filial 1, Açılış yoxlaması');
  });

  it('cuts a long problem note', () => {
    const body = renderNotification('problem.recorded', { ...problem, note: 'x'.repeat(300) }).body;
    expect(body).toBe(`Filial 1, Açılış yoxlaması: ${'x'.repeat(200)}…`);
  });

  it('writes times in the tenant’s timezone', () => {
    expect(renderNotification('checklist.due_soon', { ...occurrence, timezone: 'UTC' }).body).toBe('Açılış yoxlaması — Filial 1. 06:00-dək tamamlayın.');
    expect(renderNotification('checklist.due_soon', { ...occurrence, timezone: 'Europe/Istanbul' }).body).toBe('Açılış yoxlaması — Filial 1. 09:00-dək tamamlayın.');
    // 23:30 UTC is already the next day in Baku.
    expect(renderNotification('task.overdue', { ...task, dueAt: new Date('2026-11-02T23:30:00Z') }).body).toBe('Soyuducunun qapısını təmir edin. Son vaxt 03.11.2026 03:30 idi.');
  });
});

describe('every notification type', () => {
  const targetFor = (type: NotificationType) => {
    if (type === 'manual') return manual;
    if (type === 'checklist.assigned') return assignment;
    if (type.startsWith('checklist.')) return occurrence;
    if (type.startsWith('problem.')) return problem;
    return task;
  };

  // Task 16 adds the templates of the three SP8 audit types; it removes this filter.
  it.each(NOTIFICATION_TYPES.filter((t) => !isAuditType(t)))('%s renders a title and a body', (type) => {
    const rendered = renderNotification(type, targetFor(type));
    expect(rendered.title.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
  });

  it('names the type and the target kind when they do not fit', () => {
    expect(() => renderNotification('task.completed', occurrence)).toThrow('Notification type task.completed cannot be rendered for a occurrence target');
    expect(() => renderNotification('checklist.overdue', task)).toThrow('checklist.overdue cannot be rendered for a task target');
    expect(() => renderNotification('problem.critical', assignment)).toThrow('problem.critical cannot be rendered for a assignment target');
    expect(() => renderNotification('manual', problem)).toThrow('manual cannot be rendered for a problem target');
    expect(() => renderNotification('checklist.assigned', manual)).toThrow('checklist.assigned cannot be rendered for a manual target');
  });
});

describe('links and email', () => {
  const web = 'http://localhost:5173';

  it('links each target kind to its web page', () => {
    expect(notificationLink(web, { type: 'checklist.overdue', ...onOccurrence })).toBe(`${web}/schedule?date=2026-11-02&occurrence=${OCC}`);
    expect(notificationLink(web, { type: 'problem.critical', ...onOccurrence })).toBe(`${web}/schedule?date=2026-11-02&occurrence=${OCC}&tab=execution`);
    expect(notificationLink(web, { type: 'task.assigned', ...onTask })).toBe(`${web}/tasks?task=${TASK}`);
    expect(notificationLink(web, { type: 'manual', ...nowhere })).toBe(`${web}/notifications`);
  });

  it('mails the title as the subject and the body with the link', () => {
    const rendered = renderNotification('problem.critical', problem);
    expect(notificationMail({ to: 'menecer@example.az', webUrl: web, notification: { type: 'problem.critical', ...rendered } })).toEqual({
      to: 'menecer@example.az',
      subject: 'Kritik problem!',
      text: `Filial 1, Açılış yoxlaması: Kondisioner xarabdır\n\nAçmaq üçün: ${web}/schedule?date=2026-11-02&occurrence=${OCC}&tab=execution\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
    });
  });
});
