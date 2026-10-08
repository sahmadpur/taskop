import { blankContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PreviewPane } from './preview';

describe('PreviewPane', () => {
  it('reveals follow-ups and updates requirements and score', async () => {
    const q = newItem('yes_no') as YesNoItem;
    q.label = 'Problem var?';
    const rule = newRule(q);
    rule.when = { kind: 'options', optionIds: [q.options[0].id] };
    rule.then.problem = 'critical';
    rule.then.requirePhoto = true;
    const follow = newItem('comment');
    follow.label = 'Təsvir edin';
    rule.then.followUps.push(follow);
    q.rules.push(rule);
    renderWithProviders(<PreviewPane content={{ ...blankContent(), sections: [{ ...newSection('S'), items: [q] }] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 tələb tamamlanmayıb');
    expect(screen.queryByText('Təsvir edin')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Bəli' }));
    expect(screen.getByText('Təsvir edin')).toBeInTheDocument();
    expect(screen.getByText('Kritik problem')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 tələb tamamlanmayıb');
    expect(screen.getByRole('status')).toHaveTextContent('Bal: 0%');
    await userEvent.click(screen.getByRole('radio', { name: 'Xeyr' }));
    expect(screen.getByRole('status')).toHaveTextContent('Tamamlana bilər');
    expect(screen.getByRole('status')).toHaveTextContent('Bal: 100%');
  });
});
