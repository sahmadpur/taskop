import type { Recurrence, ShiftDto, Timing } from '@taskop/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRecurrence, defaultTiming, RecurrenceEditor, TimingEditor } from './schedule-builder';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

const json = () => JSON.parse(screen.getByTestId('json').textContent!);

function RecurrenceHarness({ initial }: { initial: Recurrence }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <RecurrenceEditor value={v} onChange={setV} today="2026-11-04" />
      <output data-testid="json">{JSON.stringify(v)}</output>
    </>
  );
}

const shifts: ShiftDto[] = [{ id: 's1', name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true }];
function TimingHarness({ initial }: { initial: Timing }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TimingEditor value={v} onChange={setV} shifts={shifts} />
      <output data-testid="json">{JSON.stringify(v)}</output>
    </>
  );
}

describe('RecurrenceEditor', () => {
  it('switches kinds with sensible defaults and keeps at least one weekday', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('daily', '2026-11-04')} />);
    await userEvent.selectOptions(screen.getByLabelText('Təkrarlanma'), 'weekly');
    expect(json()).toEqual({ kind: 'weekly', every: 1, weekdays: [3], startDate: '2026-11-04', endDate: null, skipDates: [] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cümə' }));
    expect(json().weekdays).toEqual([3, 5]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Çərşənbə' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cümə' }));
    expect(json().weekdays).toEqual([5]);
    fireEvent.change(screen.getByLabelText('Neçə həftədən bir'), { target: { value: '2' } });
    expect(json().every).toBe(2);
  });

  it('edits monthly rules, the end date and skip dates', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('daily', '2026-11-04')} />);
    await userEvent.selectOptions(screen.getByLabelText('Təkrarlanma'), 'monthly');
    expect(json().by).toEqual({ dayOfMonth: 4 });
    await userEvent.click(screen.getByRole('radio', { name: 'Həftə günü' }));
    expect(json().by).toEqual({ nth: 1, weekday: 3 });
    await userEvent.selectOptions(screen.getByLabelText('Hansı'), '-1');
    expect(json().by).toEqual({ nth: -1, weekday: 3 });
    fireEvent.change(screen.getByLabelText('Bitmə tarixi (istəyə bağlı)'), { target: { value: '2027-03-31' } });
    expect(json().endDate).toBe('2027-03-31');
    fireEvent.change(screen.getByLabelText('İstisna tarixləri'), { target: { value: '2026-12-31' } });
    await userEvent.click(screen.getByRole('button', { name: 'Tarix əlavə et' }));
    expect(json().skipDates).toEqual(['2026-12-31']);
    await userEvent.click(screen.getByRole('button', { name: 'Sil 2026-12-31' }));
    expect(json().skipDates).toEqual([]);
  });

  it('edits one-off and explicit dates', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('dates', '2026-11-04')} />);
    fireEvent.change(screen.getByLabelText('Tarixlər'), { target: { value: '2026-11-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Tarix əlavə et' }));
    expect(json().dates).toEqual(['2026-11-04', '2026-11-20']);
    // The last date cannot be removed (a rule needs at least one).
    await userEvent.click(screen.getByRole('button', { name: 'Sil 2026-11-04' }));
    expect(screen.queryByRole('button', { name: 'Sil 2026-11-20' })).toBeDisabled();
  });
});

describe('TimingEditor', () => {
  it('switches between fixed and shift timing', async () => {
    render(<TimingHarness initial={defaultTiming('fixed', [])} />);
    expect(json()).toEqual({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 });
    fireEvent.change(screen.getByLabelText('Başlama vaxtı'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('İcra müddəti (dəqiqə)'), { target: { value: '90' } });
    expect(json()).toMatchObject({ startTime: '09:30', dueAfterMinutes: 90 });
    await userEvent.selectOptions(screen.getByLabelText('Vaxt növü'), 'shift');
    expect(json()).toEqual({ mode: 'shift', shiftId: 's1', graceMinutes: 0 });
    fireEvent.change(screen.getByLabelText('Gecikmə icazəsi (dəqiqə)'), { target: { value: '30' } });
    expect(json().graceMinutes).toBe(30);
  });
});
