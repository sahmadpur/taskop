import type { NotificationTargetKind } from '@taskop/contracts';
import type { OfflineServices } from '@/offline/services';
import type { NotificationEvents, TapResponse } from './ports';
import { readPushData } from './push-data';
import { settleWithin } from './settle-within';

/** Decision 4: a tap syncs first, but never waits longer than this (offline, or an API that does not answer). */
export const SYNC_WAIT_MS = 5_000;

export type NotificationRoute =
  | { pathname: '/notifications' }
  | { pathname: '/' }
  | { pathname: '/execution/[id]'; params: { id: string } }
  | { pathname: '/task/[id]'; params: { id: string } }
  | { pathname: '/review/[id]'; params: { id: string; n: string } }
  | { pathname: '/team/run/[id]'; params: { id: string } };

export const INBOX: NotificationRoute = { pathname: '/notifications' };
export const HOME: NotificationRoute = { pathname: '/' };

/** SP8: run notifications that open the run on the Team tab when the phone does not hold it (Spec decision 15). */
export const TEAM_RUN_TYPES: ReadonlySet<string> = new Set(['run.correction_required', 'run.resubmitted', 'audit.finished']);

export interface NotificationTarget {
  targetKind: NotificationTargetKind;
  targetId: string | null;
  /** The notification type; pushes and inbox rows both carry it. */
  type?: string;
}

export interface RouteContext {
  /** The signed-in user. */
  userId: string;
  canManageTasks(): boolean;
  /** Whether the user can see the Team tab (`canSeeTeam`); absent means no. */
  canSeeTeam?(): boolean;
  sync(): Promise<void>;
  /** 'execution' when the phone holds an execution of the occurrence, 'notStarted' when only the occurrence. */
  occurrenceOnPhone(id: string): Promise<'execution' | 'notStarted' | null>;
  taskOnPhone(id: string): Promise<boolean>;
  /** A fresh nonce for /review/[id] (SP5: every visit is a new screen). */
  nonce(): string;
}

export function createRouteContext(
  services: Pick<OfflineServices, 'userId' | 'syncNow' | 'store' | 'tasks' | 'newId'>,
  canManageTasks: () => boolean,
  canSeeTeam: () => boolean = () => false,
): RouteContext {
  return {
    userId: services.userId,
    canManageTasks,
    canSeeTeam,
    sync: () => services.syncNow('manual'),
    async occurrenceOnPhone(id) {
      const o = (await services.store.occurrences()).find((x) => x.id === id);
      if (!o) return null;
      return o.execution ? 'execution' : 'notStarted';
    },
    taskOnPhone: async (id) => (await services.tasks.task(id)) !== null,
    nonce: services.newId,
  };
}

/** Spec §7.3 with decisions 2–4. Used for pushes and for inbox rows. */
export async function routeForTarget(target: NotificationTarget, ctx: RouteContext): Promise<NotificationRoute> {
  if (target.targetKind === 'none' || target.targetId === null) return INBOX;
  const id = target.targetId;
  await settleWithin(ctx.sync(), SYNC_WAIT_MS);
  if (target.targetKind === 'occurrence') {
    const where = await ctx.occurrenceOnPhone(id);
    if (where === 'execution') return { pathname: '/execution/[id]', params: { id } };
    // SP8: a manager's (or auditor's) run notification opens the run on the Team tab, also when the phone holds the
    // occurrence (claimed by someone else, so not startable here) without an execution of it.
    if (target.type !== undefined && TEAM_RUN_TYPES.has(target.type) && ctx.canSeeTeam?.()) return { pathname: '/team/run/[id]', params: { id } };
    return where === 'notStarted' ? HOME : INBOX;
  }
  if (await ctx.taskOnPhone(id)) return { pathname: '/task/[id]', params: { id } };
  return ctx.canManageTasks() ? { pathname: '/review/[id]', params: { id, n: ctx.nonce() } } : INBOX;
}

/** A push meant for someone else, or data that is not a Taskop push, opens the inbox only. */
export async function routeForPush(raw: unknown, ctx: RouteContext): Promise<NotificationRoute> {
  const data = readPushData(raw);
  if (data === null || data.userId !== ctx.userId) return INBOX;
  return routeForTarget(data, ctx);
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/**
 * Taps (listener and the launch tap, each handled once and cleared) and foreground receipts (a sync).
 * Returns the stop function: nothing navigates after it was called (logout, user switch).
 */
export function startTapRouting(o: { events: NotificationEvents; ctx: RouteContext; navigate: (route: NotificationRoute) => void }): () => void {
  const handled = new Set<string>();
  let stopped = false;
  const open = (r: TapResponse) => {
    if (stopped || handled.has(r.identifier)) return;
    handled.add(r.identifier);
    try {
      o.events.clearLastResponse();
    } catch (e) {
      console.warn('[push] Could not clear the last notification response', message(e));
    }
    routeForPush(r.data, o.ctx).then(
      (route) => {
        if (!stopped) o.navigate(route);
      },
      (e: unknown) => {
        console.error('[push] Could not open a notification; showing the inbox', message(e));
        if (!stopped) o.navigate(INBOX);
      },
    );
  };
  const offResponse = o.events.onResponse(open);
  const offReceived = o.events.onReceived((raw) => {
    const data = readPushData(raw);
    if (stopped || (data !== null && data.userId !== o.ctx.userId)) return;
    o.ctx.sync().catch((e: unknown) => console.warn('[push] The sync after a notification failed', message(e)));
  });
  const launched = o.events.lastResponse();
  if (launched) open(launched);
  return () => {
    stopped = true;
    offResponse();
    offReceived();
  };
}
