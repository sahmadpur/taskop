import { checklist, completedAnswers, REWORK_DUE, reworkRequest } from '@/offline/testing/fixtures';
import { reworkComments, reworkOverdue, reworkProgress } from './rework';

describe('rework helpers (spec §8.1)', () => {
  it('maps each flagged item to the manager’s comment', () => {
    const r = reworkRequest({ items: [{ itemId: 'a', comment: 'Yenidən ölçün' }, { itemId: 'b', comment: 'Şəkil bulanıqdır' }] });
    expect([...reworkComments(r)]).toEqual([['a', 'Yenidən ölçün'], ['b', 'Şəkil bulanıqdır']]);
    expect(reworkComments(null).size).toBe(0);
  });

  it('is overdue from the due date on, and never without one', () => {
    expect(reworkOverdue({ dueAt: REWORK_DUE }, Date.parse(REWORK_DUE) - 1)).toBe(false);
    expect(reworkOverdue({ dueAt: REWORK_DUE }, Date.parse(REWORK_DUE))).toBe(true);
    expect(reworkOverdue({ dueAt: null }, Date.parse('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('counts the visible editable items that are answered with nothing missing', () => {
    const c = checklist();
    // Two flagged items, plus the follow-up a "Bəli" reveals (hidden, so not counted, while the answer is "Xeyr").
    const editable = new Set([c.temp.id, c.photo.id, c.comment.id]);
    expect(reworkProgress(c.content, completedAnswers(c), editable)).toEqual({ done: 2, total: 2 });
    expect(reworkProgress(c.content, { ...completedAnswers(c), [c.temp.id]: { number: 10 } }, editable)).toEqual({ done: 1, total: 2 });
    expect(reworkProgress(c.content, { ...completedAnswers(c), [c.problem.id]: { optionIds: [c.yes.id] } }, editable)).toEqual({ done: 2, total: 3 });
  });
});
