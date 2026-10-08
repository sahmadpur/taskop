import type { LoginResult, Me } from '@taskop/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The ApiClient binds globalThis.fetch when the module loads, so stub it before importing session.
const fetchMock = vi.hoisted(() => {
  const fn = vi.fn<typeof fetch>();
  globalThis.fetch = fn;
  return fn;
});

const { session } = await import('./session');
const { queryClient } = await import('./query');

const me = { id: 'u1', permissions: [] } as unknown as Me;
const loginResult = { accessToken: 'access', refreshToken: null, me } as unknown as LoginResult;

function unauthenticated(): Response {
  return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'errors.UNAUTHENTICATED' } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('session', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    queryClient.clear();
  });
  afterAll(() => queryClient.clear());

  it('clears the query cache on sign-in so a previous user’s data never leaks', async () => {
    queryClient.setQueryData(['users'], [{ id: 'someone-else' }]);
    await session.signedIn(loginResult);
    expect(queryClient.getQueryData(['users'])).toBeUndefined();
    expect(session.get()).toEqual({ status: 'authenticated', me });
  });

  it('clears the query cache when the session expires', async () => {
    await session.signedIn(loginResult);
    queryClient.setQueryData(['users'], [{ id: 'cached' }]);
    fetchMock.mockImplementation(async () => unauthenticated());
    const { api } = await import('./session');
    await expect(api.me()).rejects.toBeDefined();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(queryClient.getQueryData(['users'])).toBeUndefined();
  });
});
