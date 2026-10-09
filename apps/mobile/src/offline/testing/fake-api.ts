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
  SyncResponse,
} from '@taskop/contracts';
import type { SyncApi } from '../sync-api';
import { ME, syncResponse, VERSION } from './fixtures';

export interface ApiHandlers {
  pull(knownVersionIds: string[]): Promise<SyncResponse>;
  claim(body: ClaimCommand): Promise<ClaimResult>;
  saveAnswers(id: string, body: SaveAnswersCommand): Promise<SaveAnswersResult>;
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
  registerMedia(executionId: string, body: RegisterMediaCommand): Promise<MediaUploadTicket>;
  confirmUploaded(id: string): Promise<MediaConfirmResult>;
}
export type ApiMethod = keyof ApiHandlers;
export interface ApiCall {
  method: ApiMethod;
  /** The execution ID (answers, complete, registerMedia) or media ID (confirmUploaded). */
  id: string | null;
  body: unknown;
}

export interface FakeApi {
  api: SyncApi;
  calls: ApiCall[];
  /** What a healthy server answers; custom handlers may delegate to these. */
  defaults: ApiHandlers;
  /** The /me/sync response `defaults.pull` returns. */
  sync: SyncResponse;
  on<K extends ApiMethod>(method: K, handler: ApiHandlers[K]): void;
  reset(method: ApiMethod): void;
}

const progress = { answered: 0, total: 0, requiredMissing: 0 };

export function createFakeApi(): FakeApi {
  const calls: ApiCall[] = [];
  const handlers: Partial<ApiHandlers> = {};
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
      registerMedia: async (_executionId, b) => ({
        mediaId: b.id,
        status: 'pending',
        uploadUrl: `http://files.test/taskop-media/${b.id}`,
        headers: { 'Content-Type': b.mime, 'Content-Length': String(b.bytes) },
        expiresAt: '2026-11-02T05:00:00.000Z',
      }),
      confirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: '2026-11-02T04:30:00.000Z' }),
    },
    api: {
      sync: {
        pull: async (known = []) => {
          calls.push({ method: 'pull', id: null, body: known });
          return (handlers.pull ?? fake.defaults.pull)(known);
        },
      },
      executions: {
        claim: async (b) => {
          calls.push({ method: 'claim', id: null, body: b });
          return (handlers.claim ?? fake.defaults.claim)(b);
        },
        saveAnswers: async (id, b) => {
          calls.push({ method: 'saveAnswers', id, body: b });
          return (handlers.saveAnswers ?? fake.defaults.saveAnswers)(id, b);
        },
        complete: async (id, b) => {
          calls.push({ method: 'complete', id, body: b });
          return (handlers.complete ?? fake.defaults.complete)(id, b);
        },
        registerMedia: async (executionId, b) => {
          calls.push({ method: 'registerMedia', id: executionId, body: b });
          return (handlers.registerMedia ?? fake.defaults.registerMedia)(executionId, b);
        },
      },
      media: {
        confirmUploaded: async (id) => {
          calls.push({ method: 'confirmUploaded', id, body: null });
          return (handlers.confirmUploaded ?? fake.defaults.confirmUploaded)(id);
        },
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
