import { errorBodySchema, type LoginResult, loginResultSchema } from '@taskop/contracts';
import type { ZodType } from 'zod';
import { ApiError } from './errors.js';

export interface TokenStore {
  getAccessToken(): string | null;
  save(tokens: { accessToken: string; refreshToken: string | null }): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  clear(): Promise<void>;
}

/** In-memory store: the web keeps the refresh token in an HttpOnly cookie, never in JS. */
export function memoryTokenStore(): TokenStore {
  let access: string | null = null;
  let refresh: string | null = null;
  return {
    getAccessToken: () => access,
    save: async (t) => {
      access = t.accessToken;
      if (t.refreshToken !== null) refresh = t.refreshToken;
    },
    getRefreshToken: async () => refresh,
    clear: async () => {
      access = null;
      refresh = null;
    },
  };
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions<T> {
  body?: unknown;
  query?: QueryParams;
  schema?: ZodType<T>;
  auth?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  client: 'web' | 'mobile';
  tokenStore: TokenStore;
  /** Set false for clients without refresh (platform admin). */
  refresh?: boolean;
  onSessionExpired?: () => void;
  onRefreshed?: (result: LoginResult) => void;
  fetch?: typeof fetch;
  refreshRetryDelayMs?: number;
  /**
   * Aborts a request (and a refresh) that has not settled after this long, body included, and throws a NETWORK error.
   * Unset: no limit (the web relies on the browser).
   */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toQueryString(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return new ApiError(res.status, 'INTERNAL', 'errors.INTERNAL');
  const e = parsed.data.error;
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null, e.userIds ?? null, e.missing ?? null);
}

async function isUnauthenticated(res: Response): Promise<boolean> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === 'UNAUTHENTICATED';
}

export class ApiClient {
  private refreshing: Promise<LoginResult | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  request<T>(method: string, path: string, o: RequestOptions<T> = {}): Promise<T> {
    return this.bounded(async (signal) => {
      let res = await this.send(method, path, o, signal);
      if (res.status === 401 && o.auth !== false && this.opts.refresh !== false && (await isUnauthenticated(res))) {
        const refreshed = await this.refresh();
        if (!refreshed) {
          this.opts.onSessionExpired?.();
          throw await toApiError(res);
        }
        res = await this.send(method, path, o, signal);
      }
      return this.parse(res, o.schema);
    });
  }

  /** Single-flight: concurrent callers share one refresh request. */
  refresh(): Promise<LoginResult | null> {
    this.refreshing ??= this.bounded((signal) => this.doRefresh(signal)).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Runs `work` under `timeoutMs`: on expiry its requests are aborted and the caller gets a NETWORK error. */
  private bounded<T>(work: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
    const ms = this.opts.timeoutMs;
    if (ms === undefined) return work(undefined);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(ApiError.network());
      }, ms);
    });
    return Promise.race([work(controller.signal), expired]).finally(() => clearTimeout(timer));
  }

  private async doRefresh(signal: AbortSignal | undefined): Promise<LoginResult | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = this.opts.client === 'mobile' ? await this.opts.tokenStore.getRefreshToken() : null;
      if (this.opts.client === 'mobile' && !refreshToken) break;
      const res = await this.send('POST', '/auth/refresh', { body: refreshToken ? { refreshToken } : {}, auth: false }, signal);
      if (res.ok) {
        const parsed = loginResultSchema.safeParse(await res.json().catch(() => null));
        if (!parsed.success) throw new ApiError(res.status, 'INTERNAL', 'errors.INTERNAL');
        const result = parsed.data;
        await this.opts.tokenStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
        this.opts.onRefreshed?.(result);
        return result;
      }
      // Only a rejected session logs out; transient failures (5xx, 429, ...) must not.
      if (![400, 401, 403].includes(res.status)) throw await toApiError(res);
      // Another tab may have just rotated the shared cookie: the API answers 401 within its grace window.
      if (res.status !== 401 || this.opts.client !== 'web' || attempt === 1) break;
      await sleep(this.opts.refreshRetryDelayMs ?? 300);
    }
    await this.opts.tokenStore.clear();
    return null;
  }

  private async send<T>(method: string, path: string, o: RequestOptions<T>, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = o.auth === false ? null : this.opts.tokenStore.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await this.fetchImpl(`${this.opts.baseUrl}${path}${toQueryString(o.query)}`, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw ApiError.network();
    }
  }

  private async parse<T>(res: Response, schema?: ZodType<T>): Promise<T> {
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(res.status, 'INTERNAL', 'errors.INTERNAL');
    }
    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError(res.status, 'INTERNAL', 'errors.INTERNAL');
    return parsed.data;
  }
}
