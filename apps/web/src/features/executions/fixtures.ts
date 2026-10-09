import {
  blankContent,
  type ChecklistContent,
  type ExecutionDetail,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type ExecutionSummary,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type OccurrenceDetail,
  type OccurrenceDto,
  type YesNoItem,
} from '@taskop/contracts';

/** Test data shared by the execution tests. Not imported by application code. */
export const U1 = { id: 'u1', fullName: 'Aysel Məmmədova' };
export const U2 = { id: 'u2', fullName: 'Murad Əliyev' };
const CREATED = '2026-11-02T04:20:00.000Z';

export const occurrenceDto = (over: Partial<OccurrenceDto> = {}): OccurrenceDto => ({
  id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  shiftId: null, shiftName: null, localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z',
  closesAt: '2026-11-02T07:00:00.000Z', status: 'completed', statusChangedAt: '2026-11-02T05:00:00.000Z', cancelReason: null,
  assigneeIds: ['u1', 'u2'], unassigned: false, executionBrief: null, ...over,
});

export const occurrenceDetail = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail => ({
  ...occurrenceDto(),
  assignees: [U1, U2],
  history: [],
  execution: null,
  rejectedExecutions: [],
  ...over,
});

/** Started 08:10 Baku (received a minute later: not shown); completed 09:00 (received 13:00: shown). */
export const summary = (over: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
  id: 'x1', executor: U1, state: 'completed', rejectedReason: null,
  startedAt: '2026-11-02T04:10:00.000Z', startedReceivedAt: '2026-11-02T04:11:00.000Z',
  completedAt: '2026-11-02T05:00:00.000Z', completedReceivedAt: '2026-11-02T09:00:00.000Z',
  late: false, clockSuspect: false, progress: { answered: 5, total: 6, requiredMissing: 0 }, scorePercent: 50, problemCount: 3, mediaPending: 1,
  ...over,
});

export const mediaDto = (over: Partial<ExecutionMediaDto> & { id: string }): ExecutionMediaDto => ({
  itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 1000, width: 1600, height: 1200, durationMs: null,
  capturedAt: CREATED, capturedBy: U1, status: 'uploaded', uploadedAt: '2026-11-02T04:21:00.000Z',
  ...over,
});

/**
 * Zal: "Problem varmı?" (yes → critical, follow-up "Təsvir edin"), "Temperatur" (outside 2–8 → normal + note),
 * "Ümumi görünüş" (photo). Son: "Video", "Qeyd" (optional text).
 * Answers: yes + "Su axır"; 10 °C with note "isti" and a manual critical problem with photo pm1;
 * photos m1 (uploaded) and m2 (pending); video v1 (uploaded); "Qeyd" unanswered.
 */
export function executionFixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical' };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.unit = '°C';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  const video = newItem('video');
  video.label = 'Video';
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = {
    ...blankContent(),
    sections: [
      { ...newSection('Zal'), items: [problem, temp, photo] },
      { ...newSection('Son'), items: [video, note] },
    ],
  };
  const media: ExecutionMediaDto[] = [
    mediaDto({ id: 'm1', itemId: photo.id }),
    mediaDto({ id: 'm2', itemId: photo.id, status: 'pending', uploadedAt: null }),
    mediaDto({ id: 'v1', itemId: video.id, kind: 'video', mime: 'video/mp4', width: 1280, height: 720, durationMs: 12_000 }),
    mediaDto({ id: 'pm1' }),
  ];
  const answers: ExecutionDetail['answers'] = {
    [problem.id]: { optionIds: [yes.id] },
    [comment.id]: { text: 'Su axır' },
    [temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: ['pm1'] } },
    [photo.id]: { photos: ['m1', 'm2'] },
    [video.id]: { videos: ['v1'] },
  };
  const problems: ExecutionProblem[] = [
    { id: 'pr1', itemId: problem.id, source: 'rule', severity: 'critical', note: null, mediaIds: [], createdAt: CREATED },
    { id: 'pr2', itemId: temp.id, source: 'rule', severity: 'normal', note: 'isti', mediaIds: [], createdAt: CREATED },
    { id: 'pr3', itemId: temp.id, source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: ['pm1'], createdAt: CREATED },
  ];
  const detail = (over: Partial<ExecutionDetail> = {}): ExecutionDetail => ({
    ...summary(),
    occurrence: occurrenceDto(),
    checklistVersionId: 'ver1',
    versionNumber: 3,
    content,
    answers,
    answersRev: 4,
    score: { earned: 0, possible: 2, percent: 0, problems: [] },
    clockOffsetMs: 400_000,
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    lastSyncedAt: '2026-11-02T09:00:00.000Z',
    media,
    problems,
    ...over,
  });
  return { content, problem, yes, no, comment, temp, photo, video, note, answers, media, problems, detail };
}
