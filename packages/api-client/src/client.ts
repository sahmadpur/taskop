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
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId);
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

  async request<T>(method: string, path: string, o: RequestOptions<T> = {}): Promise<T> {
    let res = await this.send(method, path, o);
    if (res.status === 401 && o.auth !== false && this.opts.refresh !== false && (await isUnauthenticated(res))) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        this.opts.onSessionExpired?.();
        throw await toApiError(res);
      }
      res = await this.send(method, path, o);
    }
    return this.parse(res, o.schema);
  }

  /** Single-flight: concurrent callers share one refresh request. */
  refresh(): Promise<LoginResult | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<LoginResult | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = this.opts.client === 'mobile' ? await this.opts.tokenStore.getRefreshToken() : null;
      if (this.opts.client === 'mobile' && !refreshToken) break;
      const res = await this.send('POST', '/auth/refresh', { body: refreshToken ? { refreshToken } : {}, auth: false });
      if (res.ok) {
        const result = loginResultSchema.parse(await res.json());
        await this.opts.tokenStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
        this.opts.onRefreshed?.(result);
        return result;
      }
      // Another tab may have just rotated the shared cookie: the API answers 401 within its grace window.
      if (res.status !== 401 || this.opts.client !== 'web' || attempt === 1) break;
      await sleep(this.opts.refreshRetryDelayMs ?? 300);
    }
    await this.opts.tokenStore.clear();
    return null;
  }

  private async send<T>(method: string, path: string, o: RequestOptions<T>): Promise<Response> {
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
      });
    } catch {
      throw ApiError.network();
    }
  }

  private async parse<T>(res: Response, schema?: ZodType<T>): Promise<T> {
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return schema ? schema.parse(json) : (json as T);
  }
}
