import { OCCURRENCE_STATUSES } from '@taskop/contracts';
import i18n from '@/lib/i18n';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, runPerson, statusTone } from './team-format';
import { AYNUR, KAMRAN } from './testing/fixtures';

const t = i18n.t.bind(i18n);

describe('team formatting', () => {
  it('writes percentages the Azerbaijani way, and a dash for none', () => {
    expect(percentText(t, 70)).toBe('70%');
    expect(percentText(t, 66.7)).toBe('66,7%');
    expect(percentText(t, 0)).toBe('0%');
    expect(percentText(t, null)).toBe('—');
  });

  it('shows a server receipt only when it is more than a minute from the device time', () => {
    const device = '2026-11-02T05:30:00.000Z';
    expect(receiptDiffers(device, '2026-11-02T05:31:00.000Z')).toBe(false);
    expect(receiptDiffers(device, '2026-11-02T05:31:00.001Z')).toBe(true);
    expect(receiptDiffers(device, '2026-11-02T05:28:59.000Z')).toBe(true);
    expect(receiptDiffers(device, null)).toBe(false);
  });

  it('colours every status', () => {
    expect(Object.fromEntries(OCCURRENCE_STATUSES.map((s) => [s, statusTone(s)]))).toEqual({
      pending: 'neutral',
      started: 'neutral',
      in_progress: 'neutral',
      completed: 'success',
      partial: 'warning',
      overdue: 'danger',
      missed: 'danger',
      cancelled: 'neutral',
      audit_pending: 'success',
      audited: 'success',
      correction_required: 'neutral',
    });
  });

  it('names the executor, else every assignee, else Təyin edilməyib', () => {
    expect(runPerson(t, { executor: AYNUR, assignees: [AYNUR, KAMRAN] })).toBe('Aynur Quliyeva');
    expect(runPerson(t, { executor: null, assignees: [AYNUR, KAMRAN] })).toBe('Aynur Quliyeva, Kamran Əliyev');
    expect(runPerson(t, { executor: null, assignees: [] })).toBe('Təyin edilməyib');
  });

  it('writes a local day and a cancel reason', () => {
    expect(formatLocalDay('2026-11-02')).toBe('02.11.2026');
    expect(cancelReasonText(t, 'assignment_edited')).toBe('Təyinat dəyişdirildi');
    expect(cancelReasonText(t, 'Mağaza təmirə bağlanıb')).toBe('Mağaza təmirə bağlanıb');
  });
});
