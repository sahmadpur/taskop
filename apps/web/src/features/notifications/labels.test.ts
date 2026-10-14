import { az } from '@taskop/i18n';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { counts, notificationItem } from './fixtures';
import { deliverySummary, notificationLink, unreadBadgeText } from './labels';

const t = i18n.t.bind(i18n);

describe('notificationLink', () => {
  it('opens an occurrence on its day, a problem on the execution tab and a task in its drawer', () => {
    expect(notificationLink(notificationItem({ type: 'checklist.overdue', targetKind: 'occurrence', targetId: 'o1', targetDate: '2026-11-02' }))).toEqual({
      to: '/schedule',
      search: { date: '2026-11-02', occurrence: 'o1' },
    });
    expect(notificationLink(notificationItem({ type: 'problem.critical', targetKind: 'occurrence', targetId: 'o1', targetDate: '2026-11-02' }))).toEqual({
      to: '/schedule',
      search: { date: '2026-11-02', occurrence: 'o1', tab: 'execution' },
    });
    expect(notificationLink(notificationItem({ type: 'task.completed', targetKind: 'task', targetId: 't9' }))).toEqual({ to: '/tasks', search: { task: 't9' } });
    expect(notificationLink(notificationItem({ type: 'manual', targetKind: 'none', targetId: null }))).toBeNull();
  });

  it('gives a notification without a target id no page, and an occurrence without a date the current week', () => {
    expect(notificationLink(notificationItem({ targetKind: 'task', targetId: null }))).toBeNull();
    expect(notificationLink(notificationItem({ type: 'checklist.available', targetKind: 'occurrence', targetId: null, targetDate: '2026-11-02' }))).toBeNull();
    expect(notificationLink(notificationItem({ type: 'checklist.available', targetKind: 'occurrence', targetId: 'o2', targetDate: null }))).toEqual({
      to: '/schedule',
      search: { occurrence: 'o2' },
    });
  });
});

describe('unreadBadgeText', () => {
  it('hides the badge at zero and caps it at 99+', () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
  });
});

describe('deliverySummary', () => {
  it('lists the statuses that occur, in catalogue order, or a dash', () => {
    const L = az.notifications.deliveryStatuses;
    expect(deliverySummary(t, counts({ failed: 1, delivered: 2 }))).toBe(`${L.delivered}: 2 · ${L.failed}: 1`);
    expect(deliverySummary(t, counts({ queued: 3 }))).toBe(`${L.queued}: 3`);
    expect(deliverySummary(t, counts())).toBe('—');
  });
});
