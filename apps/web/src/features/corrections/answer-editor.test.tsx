import { type Answer, type DateTimeItem, type Item, type MultiChoiceItem, newItem } from '@taskop/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import { AnswerEditor } from './answer-editor';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

function Harness({ item, initial, onAnswer = () => undefined }: { item: Item; initial?: Answer; onAnswer?: (a: Answer | undefined) => void }) {
  const [answer, setAnswer] = useState<Answer | undefined>(initial);
  return (
    <AnswerEditor
      item={item}
      answer={answer}
      onChange={(next) => {
        setAnswer(next);
        onAnswer(next);
      }}
    />
  );
}

describe('AnswerEditor', () => {
  it('changes a yes/no answer and keeps the note and the manual problem untouched', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    const problem = { severity: 'critical' as const, note: 'Sızma', mediaIds: [] };
    render(<Harness item={f.problem} initial={{ optionIds: [f.yes.id], note: 'Sınıq', problem }} onAnswer={onAnswer} />);
    const group = screen.getByRole('radiogroup', { name: 'Problem varmı?' });
    expect(screen.getByRole('radio', { name: 'Bəli' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Xeyr' }));
    expect(group).toBeInTheDocument();
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: [f.no.id], note: 'Sınıq', problem });
  });

  it('ticks and unticks a multi-choice option', async () => {
    const item = newItem('multi_choice') as MultiChoiceItem;
    item.label = 'Hansı otaqlar?';
    item.options = [
      { id: 'o1', label: 'Zal' },
      { id: 'o2', label: 'Anbar' },
    ];
    const onAnswer = vi.fn();
    render(<Harness item={item} initial={{ optionIds: ['o1'] }} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anbar' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: ['o1', 'o2'] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zal' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: ['o2'] });
  });

  it('edits a number with its unit, then clears the value but not the note', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    render(<Harness item={f.temp} initial={{ number: 10, note: 'isti' }} onAnswer={onAnswer} />);
    expect(screen.getByText('°C')).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    expect(onAnswer).toHaveBeenLastCalledWith({ number: 5, note: 'isti' });
    await userEvent.click(screen.getByRole('button', { name: 'Cavabı sil' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ note: 'isti' });
    expect(input).toHaveValue(null);
    expect(screen.queryByRole('button', { name: 'Cavabı sil' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Temperatur — qeyd' }));
    expect(onAnswer).toHaveBeenLastCalledWith(undefined);
  });

  it('reads and writes a date-time answer on the tenant clock, and a date as it is', () => {
    const at = newItem('datetime') as DateTimeItem;
    at.label = 'Yoxlama vaxtı';
    const onAnswer = vi.fn();
    render(<Harness item={at} initial={{ datetime: '2026-11-02T05:30:00.000Z' }} onAnswer={onAnswer} />);
    const input = screen.getByLabelText('Yoxlama vaxtı');
    expect(input).toHaveValue('2026-11-02T09:30');
    fireEvent.change(input, { target: { value: '2026-11-02T18:45' } });
    expect(onAnswer).toHaveBeenLastCalledWith({ datetime: '2026-11-02T14:45:00.000Z' });

    const day = newItem('datetime') as DateTimeItem;
    day.label = 'Tarix';
    day.mode = 'date';
    const onDay = vi.fn();
    render(<Harness item={day} initial={{ datetime: '2026-11-02' }} onAnswer={onDay} />);
    fireEvent.change(screen.getByLabelText('Tarix'), { target: { value: '2026-11-03' } });
    expect(onDay).toHaveBeenLastCalledWith({ datetime: '2026-11-03' });
  });

  it('offers no value editor for photo and video items, only the note', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    render(<Harness item={f.photo} initial={{ photos: ['m1'] }} onAnswer={onAnswer} />);
    expect(screen.getByText('Foto və videolar düzəliş zamanı dəyişdirilmir.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cavabı sil' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ümumi görünüş — qeyd' }), 'Bulanıq');
    expect(onAnswer).toHaveBeenLastCalledWith({ photos: ['m1'], note: 'Bulanıq' });
  });
});
