import type {
  ClaimCommand,
  ClaimResult,
  CompleteCommand,
  CompleteResult,
  MediaConfirmResult,
  MediaUploadTicket,
  RegisterMediaCommand,
  SaveAnswersCommand,
  SaveAnswersResult,
  SubmissionInput,
  SyncResponse,
  SyncTask,
  TaskActionCommand,
  TaskDetail,
  TaskMediaRegisterInput,
} from '@taskop/contracts';
import type { SyncApi } from '../sync-api';
import { ME, ME_REF, syncResponse, syncTask, VERSION } from './fixtures';

export interface ApiHandlers {
  pull(knownVersionIds: string[], knownTaskIds: string[]): Promise<SyncResponse>;
  claim(body: ClaimCommand): Promise<ClaimResult>;
  saveAnswers(id: string, body: SaveAnswersCommand): Promise<SaveAnswersResult>;
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
  registerMedia(executionId: string, body: RegisterMediaCommand): Promise<MediaUploadTicket>;
  confirmUploaded(id: string): Promise<MediaConfirmResult>;
  taskAccept(taskId: string, body: TaskActionCommand): Promise<TaskDetail>;
  taskStart(taskId: string, body: TaskActionCommand): Promise<TaskDetail>;
  taskSubmit(taskId: string, body: SubmissionInput): Promise<TaskDetail>;
  taskRegisterMedia(taskId: string, body: TaskMediaRegisterInput): Promise<MediaUploadTicket>;
  taskConfirmUploaded(id: string): Promise<MediaConfirmResult>;
}
export type ApiMethod = keyof ApiHandlers;
export interface ApiCall {
  method: ApiMethod;
  /** The execution or task ID (commands, registerMedia), or the media ID (confirmUploaded). */
  id: string | null;
  body: unknown;
}

export interface FakeApi {
  api: SyncApi;
  calls: ApiCall[];
  /** What a healthy server answers; custom handlers may delegate to these. */
  defaults: ApiHandlers;
  /** The /me/sync response `defaults.pull` returns. The task defaults update its `tasks` like the server would. */
  sync: SyncResponse;
  on<K extends ApiMethod>(method: K, handler: ApiHandlers[K]): void;
  reset(method: ApiMethod): void;
}

const progress = { answered: 0, total: 0, requiredMissing: 0 };
const UPLOADED_AT = '2026-11-02T04:30:00.000Z';

const ticketFor = (b: { id: string; mime: string; bytes: number }): MediaUploadTicket => ({
  mediaId: b.id,
  status: 'pending',
  uploadUrl: `http://files.test/taskop-media/${b.id}`,
  headers: { 'Content-Type': b.mime, 'Content-Length': String(b.bytes) },
  expiresAt: '2026-11-02T05:00:00.000Z',
});

export function createFakeApi(): FakeApi {
  const calls: ApiCall[] = [];
  const handlers: Partial<ApiHandlers> = {};
  /** Applies a worker command to the server's copy of a task (in `fake.sync.tasks` when listed there) and answers it. */
  const serverTask = (id: string, patch: (t: SyncTask) => Partial<SyncTask>): TaskDetail => {
    const base = fake.sync.tasks.find((t) => t.id === id) ?? syncTask({ id });
    const next: SyncTask = { ...base, ...patch(base), rev: base.rev + 1 };
    fake.sync = { ...fake.sync, tasks: fake.sync.tasks.map((t) => (t.id === id ? next : t)) };
    return { ...next, history: [], canManage: false, canReview: false };
  };
  const call = <K extends ApiMethod>(method: K, id: string | null, body: unknown): ApiHandlers[K] => {
    calls.push({ method, id, body });
    return (handlers[method] ?? fake.defaults[method]) as ApiHandlers[K];
  };
  const fake: FakeApi = {
    calls,
    sync: syncResponse({ occurrences: [] }),
    defaults: {
      pull: async () => fake.sync,
      claim: async (b) => ({
        executionId: b.id,
        state: 'active',
        reason: null,
        claim: { executionId: b.id, executorUserId: ME, executorName: 'Aysel Əliyeva' },
        checklistVersionId: VERSION,
        startedAt: b.startedAt,
        clockSuspect: false,
      }),
      saveAnswers: async (id, b) => ({ executionId: id, rev: b.rev, stale: false, state: 'active', progress }),
      complete: async (id, b) => ({ executionId: id, state: 'completed', completedAt: b.completedAt, late: false, progress, score: null }),
      registerMedia: async (_executionId, b) => ticketFor(b),
      confirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: UPLOADED_AT }),
      taskAccept: async (id, b) => serverTask(id, (t) => ({ status: 'accepted', assignee: t.assignee ?? ME_REF, acceptedAt: b.at })),
      taskStart: async (id, b) =>
        serverTask(id, (t) => ({ status: 'in_progress', assignee: t.assignee ?? ME_REF, acceptedAt: t.acceptedAt ?? b.at, startedAt: b.at })),
      taskSubmit: async (id, b) =>
        serverTask(id, (t) => ({
          status: t.requiresReview ? 'awaiting_review' : 'completed',
          submittedAt: b.submittedAt,
          completedAt: t.requiresReview ? null : b.submittedAt,
          submissions: [
            ...t.submissions,
            {
              id: b.id, submittedBy: ME_REF, text: b.text ?? '', mediaIds: b.mediaIds ?? [], submittedAt: b.submittedAt, receivedAt: b.submittedAt,
              reviewDecision: null, reviewComment: null, reviewedBy: null, reviewedAt: null,
            },
          ],
        })),
      taskRegisterMedia: async (_taskId, b) => ticketFor(b),
      taskConfirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: UPLOADED_AT }),
    },
    api: {
      sync: {
        pull: async (known = [], taskIds = []) => call('pull', null, { knownVersionIds: known, knownTaskIds: taskIds })(known, taskIds),
      },
      executions: {
        claim: async (b) => call('claim', null, b)(b),
        saveAnswers: async (id, b) => call('saveAnswers', id, b)(id, b),
        complete: async (id, b) => call('complete', id, b)(id, b),
        registerMedia: async (executionId, b) => call('registerMedia', executionId, b)(executionId, b),
      },
      media: {
        confirmUploaded: async (id) => call('confirmUploaded', id, null)(id),
      },
      tasks: {
        accept: async (id, b) => call('taskAccept', id, b)(id, b),
        start: async (id, b) => call('taskStart', id, b)(id, b),
        submit: async (id, b) => call('taskSubmit', id, b)(id, b),
        registerMedia: async (id, b) => call('taskRegisterMedia', id, b)(id, b),
      },
      taskMedia: {
        confirmUploaded: async (id) => call('taskConfirmUploaded', id, null)(id),
      },
    },
    on: (method, handler) => {
      Object.assign(handlers, { [method]: handler });
    },
    reset: (method) => {
      delete handlers[method];
    },
  };
  return fake;
}
