import { describe, expect, it } from 'vitest';
import { problemDto, taskDetail, TEAM, WORKER } from './fixtures';
import { changedFields, fieldErrors, formErrors, initialValues } from './task-form';

describe('task form', () => {
  it('pre-fills from a problem, with an empty title and instructions when the problem has none', () => {
    expect(initialValues({ problem: problemDto() }, 'Asia/Baku')).toMatchObject({
      title: 'Temperatur',
      instructions: 'Kondisioner xarabdır',
      priority: 'high',
      requiresReview: true,
      assignee: null,
    });
    expect(initialValues({ problem: problemDto({ itemLabel: null, note: null, severity: 'normal' }) }, 'Asia/Baku')).toMatchObject({
      title: '',
      instructions: '',
      priority: 'normal',
      requiresReview: true,
    });
    expect(initialValues({}, 'Asia/Baku')).toMatchObject({
      title: '',
      priority: 'normal',
      requiresReview: false,
      evidence: { photo: 'optional', video: 'optional', liveOnly: false },
    });
  });

  it('reads a task back; a team task waiting for acceptance is its team', () => {
    expect(initialValues({ task: taskDetail({ dueAt: '2026-11-03T14:00:00.000Z' }) }, 'Asia/Baku')).toMatchObject({
      assignee: { type: 'user', id: 'w1', name: 'Nigar Səfərli' },
      dueDate: '2026-11-03',
      dueTime: '18:00',
      siteId: 'site1',
    });
    expect(initialValues({ task: taskDetail({ assignee: null, team: TEAM }) }, 'Asia/Baku').assignee).toEqual({ type: 'team', id: 'team1', name: 'Texniki xidmət' });
  });

  it('sends only changed fields, and the assignee only when another one was picked', () => {
    const task = taskDetail({ dueAt: '2026-11-03T14:00:00.000Z', assignee: WORKER, team: TEAM });
    const v = initialValues({ task }, 'Asia/Baku');
    expect(changedFields(task, v, 'Asia/Baku')).toEqual({});
    expect(changedFields(task, { ...v, title: '  Yeni ad ' }, 'Asia/Baku')).toEqual({ title: 'Yeni ad' });
    expect(changedFields(task, { ...v, dueTime: '' }, 'Asia/Baku')).toEqual({ dueAt: '2026-11-03T19:59:00.000Z' });
    expect(changedFields(task, { ...v, dueDate: '', dueTime: '' }, 'Asia/Baku')).toEqual({ dueAt: null });
    expect(changedFields(task, { ...v, evidence: { ...v.evidence, video: 'none' } }, 'Asia/Baku')).toEqual({ evidence: { photo: 'optional', video: 'none', liveOnly: false } });
    // An accepted team task shows its person; picking the team again hands it back to the team (a reassign).
    expect(changedFields(task, { ...v, assignee: { type: 'team', id: 'team1', name: 'Texniki xidmət' } }, 'Asia/Baku')).toEqual({ assignee: { teamId: 'team1' } });
    expect(changedFields(task, { ...v, siteId: '' }, 'Asia/Baku')).toEqual({ siteId: null });
    // A problem task's site comes from the problem and is never sent.
    expect(changedFields({ ...task, source: 'problem' }, { ...v, siteId: 'site2' }, 'Asia/Baku')).toEqual({});
  });

  it('checks the title, the assignee and a time without a date, and maps API field errors', () => {
    const v = initialValues({}, 'Asia/Baku');
    expect(formErrors(v)).toEqual({ title: 'errors.validation.required', assignee: 'errors.validation.required' });
    expect(formErrors({ ...v, title: 'x'.repeat(201), assignee: { type: 'user', id: 'w1', name: 'N' }, dueTime: '09:00' })).toEqual({
      title: 'errors.validation.tooLong',
      dueDate: 'tasks.dialog.dateRequired',
    });
    expect(fieldErrors({ assignee: 'errors.TASK_ASSIGNEE_INVALID', dueAt: 'errors.validation.invalid', other: 'x' })).toEqual({
      assignee: 'errors.TASK_ASSIGNEE_INVALID',
      dueDate: 'errors.validation.invalid',
    });
  });
});
