import { describe, expect, it } from 'vitest';
import { targetOptions } from './fixtures';
import { canPreview, EMPTY_MESSAGE, type MessageDraft, cappedKinds, previewVerdict, sendBody } from './message-form';

const draft = (over: Partial<MessageDraft> = {}): MessageDraft => ({
  targets: { users: [{ id: 'w1', name: 'Nigar' }], teams: [{ id: 'team1', name: 'Texniki xidmət' }], sites: [] },
  title: '  Sabah iclas var ',
  body: ' Saat 10:00-da. ',
  email: true,
  ...over,
});

describe('message form', () => {
  it('trims the text and lists the ids of each kind', () => {
    expect(sendBody(draft())).toEqual({ title: 'Sabah iclas var', body: 'Saat 10:00-da.', userIds: ['w1'], teamIds: ['team1'], siteIds: [], email: true });
  });

  it('can be previewed only with a target and a title and body that are not blank', () => {
    expect(canPreview(draft())).toBe(true);
    expect(canPreview(EMPTY_MESSAGE)).toBe(false);
    expect(canPreview(draft({ targets: { users: [], teams: [], sites: [] } }))).toBe(false);
    expect(canPreview(draft({ title: '   ' }))).toBe(false);
    expect(canPreview(draft({ body: '\n ' }))).toBe(false);
    expect(canPreview(draft({ title: 'x'.repeat(81) }))).toBe(false);
  });

  it('refuses a preview that reaches nobody or more than 1000 people', () => {
    expect(previewVerdict(1)).toEqual({ ok: true });
    expect(previewVerdict(1000)).toEqual({ ok: true });
    expect(previewVerdict(0)).toEqual({ ok: false, issue: 'notifications.issues.noRecipients' });
    expect(previewVerdict(1001)).toEqual({ ok: false, issue: 'notifications.issues.tooManyRecipients' });
  });

  it('names the kinds whose list the API cut at its cap (people and teams 50, sites 200)', () => {
    const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
    const people = (n: number) => many(n, (i) => ({ id: `u${i}`, fullName: `U${i}`, jobTitle: null }));
    const places = (n: number) => many(n, (i) => ({ id: `s${i}`, name: `S${i}` }));
    expect(cappedKinds(targetOptions())).toEqual([]);
    expect(cappedKinds(targetOptions({ users: people(49), sites: places(199) }))).toEqual([]);
    expect(cappedKinds(targetOptions({ users: people(50) }))).toEqual(['users']);
    expect(cappedKinds(targetOptions({ teams: many(50, (i) => ({ id: `t${i}`, name: `T${i}`, memberCount: 1 })), sites: places(200) }))).toEqual([
      'teams',
      'sites',
    ]);
  });
});
