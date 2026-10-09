import {
  blankContent,
  type ChecklistContent,
  type DeviceInfo,
  type MyExecution,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type PhotoItem,
  type SyncChecklistVersion,
  type SyncOccurrence,
  type SyncResponse,
  type YesNoItem,
} from '@taskop/contracts';
import type { Clock } from '../clock';
import { uuidv7 } from '../ids';

export const ME = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
export const OTHER = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
export const OTHER_EXECUTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e03';
export const OCC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e10';
export const OCC2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e11';
export const OCC3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e12';
export const OCC4 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e13';
export const OCC5 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e14';
export const VERSION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e20';
export const VERSION2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e21';
export const CHECKLIST = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e30';
export const SITE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e40';

/** Monday 2 Nov 2026 in Baku (UTC+4): window 08:00–11:00, due 10:00. */
export const T = {
  before: '2026-11-02T03:50:00.000Z',
  starts: '2026-11-02T04:00:00.000Z',
  open: '2026-11-02T04:10:00.000Z',
  due: '2026-11-02T06:00:00.000Z',
  closes: '2026-11-02T07:00:00.000Z',
} as const;

export const DEVICE: DeviceInfo = { platform: 'ios', osVersion: '26.0', appVersion: '0.1.0' };

export interface ManualClock extends Clock {
  set(isoTime: string): void;
  advance(ms: number): void;
}

export function manualClock(start: string): ManualClock {
  let t = Date.parse(start);
  return {
    now: () => t,
    set: (s) => {
      t = Date.parse(s);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Distinct, time-ordered UUIDv7s for tests. */
export function testIds(clock: Clock): () => string {
  let n = 0;
  return () => uuidv7(clock.now() + n++, (k) => globalThis.crypto.getRandomValues(new Uint8Array(k)));
}

/**
 * Section "Zal": problem (yes → critical + photo + follow-up comment; photo evidence optional), temp (outside 2–8 → normal + note).
 * Section "Vitrin": photo (1–2, live-only), note (optional text).
 */
export function checklist() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Soyuducuda problem varmı?';
  problem.evidence = { photo: 'optional', video: 'none', liveOnly: false };
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Problemi təsvir edin';
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
  const photo = newItem('photo') as PhotoItem;
  photo.label = 'Vitrinin şəkli';
  photo.minCount = 1;
  photo.maxCount = 2;
  photo.evidence = { photo: 'none', video: 'none', liveOnly: true };
  const note = newItem('text');
  note.label = 'Əlavə qeyd';
  note.required = false;
  const content: ChecklistContent = {
    ...blankContent(),
    sections: [
      { ...newSection('Zal'), items: [problem, temp] },
      { ...newSection('Vitrin'), items: [photo, note] },
    ],
  };
  return { content, problem, yes, no, comment, temp, photo, note };
}
export type Checklist = ReturnType<typeof checklist>;

export const versionOf = (content: unknown, id = VERSION, schemaVersion = 1): SyncChecklistVersion => ({
  id,
  checklistId: CHECKLIST,
  number: 1,
  schemaVersion,
  content,
});

export const occurrence = (over: Partial<SyncOccurrence> = {}): SyncOccurrence => ({
  id: OCC,
  checklistId: CHECKLIST,
  checklistName: 'Açılış yoxlaması',
  siteId: SITE,
  siteName: 'Bakı filialı 1',
  shiftName: 'Səhər',
  localDate: '2026-11-02',
  startsAt: T.starts,
  dueAt: T.due,
  closesAt: T.closes,
  status: 'pending',
  checklistVersionId: VERSION,
  claim: null,
  ...over,
});

export const syncResponse = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  serverTime: T.open,
  occurrences: [occurrence()],
  checklistVersions: [],
  executions: [],
  ...over,
});

export const myExecution = (over: Partial<MyExecution> = {}): MyExecution => ({
  id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50',
  occurrenceId: OCC,
  checklistVersionId: VERSION,
  state: 'active',
  rejectedReason: null,
  startedAt: T.open,
  completedAt: null,
  answers: {},
  answersRev: 0,
  progress: { answered: 0, total: 4, requiredMissing: 3 },
  late: false,
  clockSuspect: false,
  mediaPending: 0,
  ...over,
});
