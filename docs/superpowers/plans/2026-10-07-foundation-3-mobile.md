# Taskop Foundation — Part 3: Mobile App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Taskop Expo app shell: worker login (org code + username + PIN) and staff login (email + password), secure token storage with automatic refresh, offline-tolerant session restore, a placeholder home screen in the style of the mockup (product document p. 20), and a profile screen with PIN/password change and logout.

**Architecture:** Expo (latest SDK) with Expo Router. The shared `@taskop/api-client` runs in `mobile` mode: the refresh token lives in Expo SecureStore and is sent in the request body. The session store keeps the last `Me` profile in SecureStore so a worker who opens the app offline stays signed in (offline *checklist execution* is sub-project 4). Screens are thin route files around testable components in `src/features`.

**Tech Stack:** Expo SDK (latest, currently 57), Expo Router, React Native, expo-secure-store, TanStack Query, react-hook-form + Zod, i18next, Jest (jest-expo) + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-07-foundation-design.md` (§9). **Depends on:** Part 1 (API) and Part 2 Task W1 (`@taskop/api-client`).

## Global Constraints

- All Part 1 and Part 2 Global Constraints apply.
- Install Expo-managed packages with `pnpm --filter @taskop/mobile exec expo install <pkg>` so versions match the SDK; everything else with `pnpm add <pkg>@latest`.
- App name **Taskop**; bundle id / package `az.taskop.app`; URL scheme `taskop`.
- Tokens: access token in memory; refresh token, cached `Me` and the remembered org code in SecureStore. Never AsyncStorage for tokens.
- A network failure must never log the user out; only an API `UNAUTHENTICATED` on refresh does.
- Touch targets ≥ 44 pt; all text from `@taskop/i18n` (`mobile` namespace plus shared `common`/`errors`).

## Review Focus

1. **App opened with no internet** (NFR-08.04): expected to show the cached profile with an offline notice, not the login screen. Pinned in Task M1 (`restores the cached profile when offline`).
2. **Org code typed with capitals/spaces** (` ACME `): expected to log in and be remembered as `acme`. Pinned in Task M2.
3. **Refresh token revoked server-side** (admin deactivated the worker): expected to land on login and wipe stored tokens/profile. Pinned in Task M1 (`clears storage when refresh is rejected`).
4. **Weak new PIN on the change screen** (`123456`): expected to show the field error, not a generic failure. Pinned in Task M2 (`shows the weak-PIN field error`).
5. **Logout while offline**: expected to clear local credentials even though the server call fails. Pinned in Task M1 (`signs out locally even when the server is unreachable`).

---

## File Structure

```
packages/i18n/src/az/mobile.ts
apps/mobile/
├─ app.json, package.json, tsconfig.json, metro.config.js, babel.config.js (only if the template has one), .env.example
├─ app/
│  ├─ _layout.tsx          providers, session bootstrap, protected stacks
│  ├─ login.tsx
│  └─ (app)/_layout.tsx, index.tsx, profile.tsx, change-secret.tsx
└─ src/
   ├─ lib/       i18n.ts, secure-storage.ts, session.ts, theme.ts
   ├─ components/ field.tsx, primary-button.tsx, form-error.tsx, screen.tsx
   └─ features/
      ├─ auth/    login-screen.tsx, login-screen.test.tsx
      ├─ home/    home-screen.tsx
      └─ profile/ profile-screen.tsx, change-secret-screen.tsx, change-secret-screen.test.tsx
   (src/lib/session.test.ts)
```

---

### Task M1: Expo app scaffold, secure session store, i18n

**Files:**
- Create: `apps/mobile/*` from the Expo template, then: `app.json`, `package.json` (edits), `tsconfig.json`, `metro.config.js`, `.env.example`
- Create: `apps/mobile/src/lib/i18n.ts`, `src/lib/secure-storage.ts`, `src/lib/session.ts`, `src/lib/theme.ts`
- Create: `apps/mobile/app/_layout.tsx` (temporary single screen; routes are completed in M2)
- Create: `packages/i18n/src/az/mobile.ts`; Modify: `packages/i18n/src/az/index.ts`
- Test: `apps/mobile/src/lib/session.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `createTaskopApi`, `ApiError`, `TokenStore` from `@taskop/api-client`.
- Produces:
  - `secureStorage { get(key): Promise<string|null>; set(key, value): Promise<void>; remove(key): Promise<void> }` and `STORAGE_KEYS = { refreshToken, me, orgCode }`.
  - `type MobileSession = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: Me; offline: boolean }`.
  - `session { get(); subscribe(l); bootstrap(); signedIn(r: LoginResult); refreshMe(); signOut(); rememberOrgCode(code); getOrgCode(): Promise<string|null> }`, `useSession()`, `api: TaskopApi`.
  - `colors`, `spacing` in `theme.ts`.

- [ ] **Step 1: Create the app from the Expo template**

```bash
pnpm create expo-app@latest apps/mobile --template blank-typescript --no-install
cd apps/mobile
```
Edit `apps/mobile/package.json`: set `"name": "@taskop/mobile"`, `"private": true`, `"main": "expo-router/entry"`, and these scripts (keep the template's others):
```json
"scripts": {
  "dev": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test": "jest"
}
```
Then from the repo root:
```bash
pnpm install
pnpm --filter @taskop/mobile exec expo install expo-router expo-linking expo-constants expo-status-bar expo-secure-store react-native-safe-area-context react-native-screens
pnpm --filter @taskop/mobile exec expo install jest-expo jest @types/jest -- --save-dev
pnpm --filter @taskop/mobile add @tanstack/react-query@latest react-hook-form@latest @hookform/resolvers@latest i18next@latest react-i18next@latest zod@latest "@taskop/contracts@workspace:*" "@taskop/i18n@workspace:*" "@taskop/api-client@workspace:*"
pnpm --filter @taskop/mobile add -D @testing-library/react-native@latest eslint@latest "@taskop/config@workspace:*"
```
Delete the template's `App.tsx` and `index.ts` (Expo Router's entry replaces them).

`apps/mobile/app.json`:
```json
{
  "expo": {
    "name": "Taskop",
    "slug": "taskop",
    "scheme": "taskop",
    "version": "0.1.0",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "ios": { "bundleIdentifier": "az.taskop.app", "supportsTablet": false },
    "android": { "package": "az.taskop.app" },
    "plugins": ["expo-router", "expo-secure-store"],
    "experiments": { "typedRoutes": true }
  }
}
```
(Keep the template's `icon`/`splash` entries if present.)

`apps/mobile/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

`apps/mobile/metro.config.js`:
```js
const { getDefaultConfig } = require('expo/metro-config');

// Expo's default config detects the pnpm workspace and watches packages/*.
module.exports = getDefaultConfig(__dirname);
```

Add Jest config to `apps/mobile/package.json`:
```json
"jest": {
  "preset": "jest-expo",
  "moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" },
  "transformIgnorePatterns": [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|react-navigation|@react-navigation/.*|@taskop/.*|zod))"
  ]
}
```

`apps/mobile/.env.example`:
```
# Use your computer's LAN IP when running on a physical phone, e.g. http://192.168.1.20:3000
EXPO_PUBLIC_API_URL=http://localhost:3000
```

`apps/mobile/eslint.config.js`:
```js
import base from '@taskop/config/eslint';
export default base;
```
(If Metro fails to resolve workspace packages under pnpm's isolated layout, add `node-linker=hoisted` to the root `.npmrc` and re-run `pnpm install`.)

- [ ] **Step 2: Mobile translations**

`packages/i18n/src/az/mobile.ts`:
```ts
export default {
  tabs: { home: 'Əsas', profile: 'Profil' },
  login: {
    title: 'Daxil ol',
    worker: 'İşçi',
    staff: 'Rəhbər',
    orgCode: 'Təşkilat kodu',
    username: 'İstifadəçi adı',
    secret: 'PIN və ya şifrə',
    email: 'E-poçt',
    password: 'Şifrə',
    submit: 'Daxil ol',
    hint: 'Giriş məlumatlarını rəhbərinizdən alın.',
  },
  home: {
    greeting: 'Salam, {{name}}!',
    subtitle: 'Bu gün üçün yoxlamalar tezliklə burada görünəcək.',
    myTasks: 'Mənim tapşırıqlarım',
    overdue: 'Gecikən',
    completed: 'Tamamlanan (bu ay)',
    issues: 'Uyğunsuzluq (bu ay)',
    recent: 'Son tapşırıqlar',
    empty: 'Hələ tapşırıq yoxdur.',
    offline: 'Oflayn rejim — internet bərpa olunanda məlumatlar yenilənəcək.',
  },
  profile: {
    title: 'Profil',
    role: 'Rol',
    organization: 'Təşkilat',
    login: 'Giriş',
    changeSecret: 'PIN/şifrəni dəyiş',
    logout: 'Çıxış',
  },
  changeSecret: {
    title: 'PIN/şifrəni dəyiş',
    current: 'Cari PIN/şifrə',
    next: 'Yeni PIN/şifrə',
    submit: 'Dəyiş',
    done: 'Dəyişdirildi.',
  },
} as const;
```
Register `mobile` in `packages/i18n/src/az/index.ts`; run `pnpm --filter @taskop/i18n build`.

- [ ] **Step 3: Write the failing test**

`apps/mobile/src/lib/session.test.ts`:
```ts
const store = new Map<string, string>();
jest.mock('./secure-storage', () => ({
  STORAGE_KEYS: { refreshToken: 'taskop.refreshToken', me: 'taskop.me', orgCode: 'taskop.orgCode' },
  secureStorage: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    remove: jest.fn(async (k: string) => void store.delete(k)),
  },
}));

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const me = {
  user: { id, fullName: 'Elvin Məmmədov', jobTitle: null, kind: 'worker', email: null, username: 'elvin', emailVerified: false, credentialKind: 'pin' },
  role: { id, name: 'Worker', systemKey: 'worker', dataScope: 'own' },
  permissions: [],
  tenant: { id, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
};
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, clone() { return this; } }) as unknown as Response;

let session: typeof import('./session').session;

beforeEach(async () => {
  store.clear();
  jest.resetModules();
  global.fetch = jest.fn();
  ({ session } = await import('./session'));
});

describe('mobile session', () => {
  it('is anonymous without a stored refresh token', async () => {
    await session.bootstrap();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('restores the session through refresh and caches the profile', async () => {
    store.set('taskop.refreshToken', 'r1');
    (global.fetch as jest.Mock).mockResolvedValue(json(200, { accessToken: 'a', accessTokenExpiresAt: '2026-10-07T10:00:00.000Z', refreshToken: 'r2', me }));
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: false });
    expect(store.get('taskop.refreshToken')).toBe('r2');
    expect(JSON.parse(store.get('taskop.me')!).user.username).toBe('elvin');
  });

  it('restores the cached profile when offline', async () => {
    store.set('taskop.refreshToken', 'r1');
    store.set('taskop.me', JSON.stringify(me));
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: true });
    expect(store.get('taskop.refreshToken')).toBe('r1');
  });

  it('clears storage when refresh is rejected', async () => {
    store.set('taskop.refreshToken', 'r1');
    store.set('taskop.me', JSON.stringify(me));
    (global.fetch as jest.Mock).mockResolvedValue(
      json(401, { error: { code: 'UNAUTHENTICATED', messageKey: 'errors.UNAUTHENTICATED', fields: null, retryAfterSeconds: null, requestId: null } }),
    );
    await session.bootstrap();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(store.has('taskop.refreshToken')).toBe(false);
    expect(store.has('taskop.me')).toBe(false);
  });

  it('signs out locally even when the server is unreachable', async () => {
    await session.signedIn({ accessToken: 'a', accessTokenExpiresAt: '2026-10-07T10:00:00.000Z', refreshToken: 'r1', me } as never);
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.signOut();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(store.has('taskop.refreshToken')).toBe(false);
  });

  it('remembers the org code', async () => {
    await session.rememberOrgCode('acme');
    expect(await session.getOrgCode()).toBe('acme');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @taskop/mobile test`
Expected: FAIL — `./session` / `./secure-storage` not found.

- [ ] **Step 5: Implement**

`apps/mobile/src/lib/secure-storage.ts`:
```ts
import * as SecureStore from 'expo-secure-store';

export const STORAGE_KEYS = {
  refreshToken: 'taskop.refreshToken',
  me: 'taskop.me',
  orgCode: 'taskop.orgCode',
} as const;

export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
```

`apps/mobile/src/lib/session.ts`:
```ts
import { ApiClient, ApiError, createTaskopApi, type TokenStore } from '@taskop/api-client';
import { type LoginResult, type Me, meSchema } from '@taskop/contracts';
import { useSyncExternalStore } from 'react';
import { secureStorage, STORAGE_KEYS } from './secure-storage';

export type MobileSession = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: Me; offline: boolean };

let state: MobileSession = { status: 'loading' };
const listeners = new Set<() => void>();
function set(next: MobileSession): void {
  state = next;
  listeners.forEach((l) => l());
}

let accessToken: string | null = null;
const tokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  async save(t) {
    accessToken = t.accessToken;
    if (t.refreshToken) await secureStorage.set(STORAGE_KEYS.refreshToken, t.refreshToken);
  },
  getRefreshToken: () => secureStorage.get(STORAGE_KEYS.refreshToken),
  async clear() {
    accessToken = null;
    await secureStorage.remove(STORAGE_KEYS.refreshToken);
    await secureStorage.remove(STORAGE_KEYS.me);
  },
};

const cacheMe = (me: Me) => secureStorage.set(STORAGE_KEYS.me, JSON.stringify(me));

async function loadCachedMe(): Promise<Me | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.me);
  if (!raw) return null;
  const parsed = meSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

const apiClient = new ApiClient({
  baseUrl: `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/v1`,
  client: 'mobile',
  tokenStore,
  onSessionExpired: () => set({ status: 'anonymous' }),
  onRefreshed: (r) => {
    void cacheMe(r.me);
    set({ status: 'authenticated', me: r.me, offline: false });
  },
});
export const api = createTaskopApi(apiClient);

export const session = {
  get: (): MobileSession => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async bootstrap(): Promise<void> {
    if (!(await tokenStore.getRefreshToken())) return set({ status: 'anonymous' });
    try {
      const result = await apiClient.refresh();
      if (!result) set({ status: 'anonymous' });
    } catch (e) {
      const cached = e instanceof ApiError && e.code === 'NETWORK' ? await loadCachedMe() : null;
      set(cached ? { status: 'authenticated', me: cached, offline: true } : { status: 'anonymous' });
    }
  },
  async signedIn(result: LoginResult): Promise<void> {
    await tokenStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    await cacheMe(result.me);
    set({ status: 'authenticated', me: result.me, offline: false });
  },
  async refreshMe(): Promise<void> {
    const me = await api.me();
    await cacheMe(me);
    set({ status: 'authenticated', me, offline: false });
  },
  async signOut(): Promise<void> {
    try {
      await api.auth.logout();
    } catch {
      // Offline or already revoked: local sign-out still has to happen.
    }
    await tokenStore.clear();
    set({ status: 'anonymous' });
  },
  rememberOrgCode: (code: string) => secureStorage.set(STORAGE_KEYS.orgCode, code),
  getOrgCode: () => secureStorage.get(STORAGE_KEYS.orgCode),
};

export function useSession(): MobileSession {
  return useSyncExternalStore(session.subscribe, session.get);
}
```

`apps/mobile/src/lib/i18n.ts`:
```ts
import { DEFAULT_LOCALE, resources } from '@taskop/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

export default i18n;
```

`apps/mobile/src/lib/theme.ts`:
```ts
export const colors = {
  primary: '#1D5BD8',
  primaryText: '#FFFFFF',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  danger: '#DC2626',
  warning: '#F59E0B',
  success: '#16A34A',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
```

`apps/mobile/app/_layout.tsx` (temporary until M2 adds the protected stacks):
```tsx
import '@/lib/i18n';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile packages/i18n pnpm-lock.yaml
git commit -m "feat(mobile): scaffold Expo app with secure, offline-tolerant session store"
```

---

### Task M2: Login, home, profile and PIN change screens

**Files:**
- Create: `apps/mobile/src/components/field.tsx`, `primary-button.tsx`, `form-error.tsx`, `screen.tsx`
- Create: `apps/mobile/src/features/auth/login-screen.tsx`, `src/features/home/home-screen.tsx`, `src/features/profile/profile-screen.tsx`, `src/features/profile/change-secret-screen.tsx`
- Create: `apps/mobile/app/login.tsx`, `app/(app)/_layout.tsx`, `app/(app)/index.tsx`, `app/(app)/profile.tsx`, `app/(app)/change-secret.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Test: `apps/mobile/src/features/auth/login-screen.test.tsx`, `apps/mobile/src/features/profile/change-secret-screen.test.tsx`

**Interfaces:**
- Consumes: `session`, `useSession`, `api` (M1), contracts schemas, `errorMessageKey`.
- Produces:
  - `Field({ label, value, onChangeText, error?, secureTextEntry?, keyboardType?, autoCapitalize?, autoComplete? })` (sets `accessibilityLabel={label}`), `PrimaryButton({ title, onPress, disabled?, variant? })`, `FormError({ message })`, `Screen({ children, scroll? })`.
  - `mobileErrorText(t, e)` in `form-error.tsx` (same rules as the web `errorText`).
  - `LoginScreen`, `HomeScreen`, `ProfileScreen`, `ChangeSecretScreen({ onDone })`.
  - Routes: `/login` (anonymous only), `/(app)` tabs `index` and `profile` (authenticated only), `/(app)/change-secret` (hidden from tabs).

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/auth/login-screen.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import { LoginScreen } from './login-screen';

const loginWorker = jest.fn();
const loginStaff = jest.fn();
const signedIn = jest.fn();
const rememberOrgCode = jest.fn();
let storedOrgCode: string | null = null;

jest.mock('@/lib/session', () => ({
  api: { auth: { loginWorker: (...a: unknown[]) => loginWorker(...a), loginStaff: (...a: unknown[]) => loginStaff(...a) } },
  session: {
    signedIn: (...a: unknown[]) => signedIn(...a),
    rememberOrgCode: (...a: unknown[]) => rememberOrgCode(...a),
    getOrgCode: async () => storedOrgCode,
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  storedOrgCode = null;
});

describe('LoginScreen', () => {
  it('logs a worker in with normalised identifiers and remembers the org code', async () => {
    loginWorker.mockResolvedValue({ accessToken: 'a' });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Təşkilat kodu'), ' ACME ');
    fireEvent.changeText(screen.getByLabelText('İstifadəçi adı'), 'Elvin');
    fireEvent.changeText(screen.getByLabelText('PIN və ya şifrə'), '730184');
    fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledWith({ accessToken: 'a' }));
    expect(loginWorker).toHaveBeenCalledWith({ orgCode: 'acme', username: 'elvin', secret: '730184', client: 'mobile' });
    expect(rememberOrgCode).toHaveBeenCalledWith('acme');
  });

  it('prefills the remembered org code', async () => {
    storedOrgCode = 'acme';
    render(<LoginScreen />);
    await waitFor(() => expect(screen.getByLabelText('Təşkilat kodu').props.value).toBe('acme'));
  });

  it('shows the translated API error', async () => {
    const { ApiError } = jest.requireActual('@taskop/api-client');
    loginWorker.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'errors.INVALID_CREDENTIALS'));
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Təşkilat kodu'), 'acme');
    fireEvent.changeText(screen.getByLabelText('İstifadəçi adı'), 'elvin');
    fireEvent.changeText(screen.getByLabelText('PIN və ya şifrə'), '000001');
    fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findByText('Giriş məlumatları yanlışdır.')).toBeTruthy();
  });

  it('switches to staff login', async () => {
    loginStaff.mockResolvedValue({ accessToken: 's' });
    render(<LoginScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Rəhbər' }));
    fireEvent.changeText(screen.getByLabelText('E-poçt'), ' Leyla@Acme.az ');
    fireEvent.changeText(screen.getByLabelText('Şifrə'), 'manager password');
    fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    await waitFor(() => expect(loginStaff).toHaveBeenCalledWith({ email: 'leyla@acme.az', password: 'manager password', client: 'mobile' }));
  });
});
```

`apps/mobile/src/features/profile/change-secret-screen.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import { ChangeSecretScreen } from './change-secret-screen';

const changeCredential = jest.fn();
jest.mock('@/lib/session', () => ({ api: { auth: { changeCredential: (...a: unknown[]) => changeCredential(...a) } } }));

describe('ChangeSecretScreen', () => {
  it('shows the weak-PIN field error', async () => {
    const { ApiError } = jest.requireActual('@taskop/api-client');
    changeCredential.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { newSecret: 'errors.validation.pinWeak' }));
    render(<ChangeSecretScreen onDone={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText('Cari PIN/şifrə'), '730184');
    fireEvent.changeText(screen.getByLabelText('Yeni PIN/şifrə'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Dəyiş' }));
    expect(await screen.findByText('Bu PIN çox sadədir. Başqa PIN seçin.')).toBeTruthy();
  });

  it('calls onDone after a successful change', async () => {
    changeCredential.mockResolvedValue(undefined);
    const onDone = jest.fn();
    render(<ChangeSecretScreen onDone={onDone} />);
    fireEvent.changeText(screen.getByLabelText('Cari PIN/şifrə'), '730184');
    fireEvent.changeText(screen.getByLabelText('Yeni PIN/şifrə'), '482915');
    fireEvent.press(screen.getByRole('button', { name: 'Dəyiş' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(changeCredential).toHaveBeenCalledWith({ currentSecret: '730184', newSecret: '482915' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @taskop/mobile test`
Expected: FAIL — screen modules missing.

- [ ] **Step 3: Implement components**

`apps/mobile/src/components/field.tsx`:
```tsx
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';

interface Props extends Pick<TextInputProps, 'value' | 'onChangeText' | 'secureTextEntry' | 'keyboardType' | 'autoCapitalize' | 'autoComplete' | 'onBlur'> {
  label: string;
  error?: string | null;
}

export function Field({ label, error, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        style={[styles.input, error ? styles.inputError : null]}
        placeholderTextColor={colors.muted}
        {...input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '500', color: colors.text },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
```

`apps/mobile/src/components/primary-button.tsx`:
```tsx
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/lib/theme';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
}

export function PrimaryButton({ title, onPress, disabled, variant = 'primary' }: Props) {
  const outline = variant === 'outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, outline ? styles.outline : styles.primary, (pressed || disabled) && styles.dim]}
    >
      <Text style={[styles.text, outline ? styles.outlineText : null]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  dim: { opacity: 0.6 },
  text: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  outlineText: { color: colors.primary },
});
```

`apps/mobile/src/components/form-error.tsx`:
```tsx
import { ApiError } from '@taskop/api-client';
import type { TFunction } from 'i18next';
import { StyleSheet, Text } from 'react-native';
import { colors } from '@/lib/theme';

export function mobileErrorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const minutes = e.retryAfterSeconds ? Math.ceil(e.retryAfterSeconds / 60) : 1;
    return t(e.messageKey, { minutes, requestId: e.requestId ?? '—' });
  }
  return t('errors.INTERNAL', { requestId: '—' });
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({ error: { color: colors.danger, fontSize: 14 } });
```

`apps/mobile/src/components/screen.tsx`:
```tsx
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
});
```

- [ ] **Step 4: Implement the screens**

`apps/mobile/src/features/auth/login-screen.tsx`:
```tsx
import { loginStaffInputSchema, loginWorkerInputSchema } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, session } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

type Mode = 'worker' | 'staff';

export function LoginScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('worker');
  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void session.getOrgCode().then((code) => {
      if (code) setOrgCode((current) => current || code);
    });
  }, []);

  const submit = async () => {
    setError(null);
    const parsed =
      mode === 'worker'
        ? loginWorkerInputSchema.safeParse({ orgCode, username, secret, client: 'mobile' })
        : loginStaffInputSchema.safeParse({ email, password, client: 'mobile' });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      if (parsed.data && 'orgCode' in parsed.data) {
        const result = await api.auth.loginWorker(parsed.data);
        await session.rememberOrgCode(parsed.data.orgCode);
        await session.signedIn(result);
      } else {
        await session.signedIn(await api.auth.loginStaff(parsed.data));
      }
    } catch (e) {
      setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) => (fieldErrors[name] ? t(fieldErrors[name]) : null);

  return (
    <Screen>
      <Text style={styles.brand}>Taskop</Text>
      <Text style={styles.title}>{t('mobile.login.title')}</Text>
      <View style={styles.toggle}>
        {(['worker', 'staff'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
            style={[styles.toggleItem, mode === m && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{t(`mobile.login.${m}`)}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'worker' ? (
        <>
          <Field label={t('mobile.login.orgCode')} value={orgCode} onChangeText={setOrgCode} autoCapitalize="none" error={fieldError('orgCode')} />
          <Field label={t('mobile.login.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" error={fieldError('username')} />
          <Field label={t('mobile.login.secret')} value={secret} onChangeText={setSecret} secureTextEntry autoComplete="password" error={fieldError('secret')} />
        </>
      ) : (
        <>
          <Field label={t('mobile.login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={fieldError('email')} />
          <Field label={t('mobile.login.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={fieldError('password')} />
        </>
      )}
      <FormError message={error} />
      <PrimaryButton title={t('mobile.login.submit')} onPress={() => void submit()} disabled={busy} />
      <Text style={styles.hint}>{t('mobile.login.hint')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 28, fontWeight: '700', color: colors.primary, marginTop: spacing.lg },
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
  toggle: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 4 },
  toggleItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  toggleActive: { backgroundColor: colors.surface },
  toggleText: { color: colors.muted, fontWeight: '500' },
  toggleTextActive: { color: colors.text },
  hint: { color: colors.muted, textAlign: 'center' },
});
```

`apps/mobile/src/features/home/home-screen.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

const STATS = [
  { key: 'myTasks', color: colors.text },
  { key: 'overdue', color: colors.danger },
  { key: 'completed', color: colors.success },
  { key: 'issues', color: colors.danger },
] as const;

export function HomeScreen() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  const firstName = s.me.user.fullName.split(' ')[0];
  return (
    <Screen>
      {s.offline && (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{t('mobile.home.offline')}</Text>
        </View>
      )}
      <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
      <Text style={styles.subtitle}>{t('mobile.home.subtitle')}</Text>
      <View style={styles.grid}>
        {STATS.map((stat) => (
          <View key={stat.key} style={styles.card}>
            <Text style={[styles.value, { color: stat.color }]}>—</Text>
            <Text style={styles.cardLabel}>{t(`mobile.home.${stat.key}`)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.section}>{t('mobile.home.recent')}</Text>
      <View style={styles.empty}>
        <Text style={styles.subtitle}>{t('mobile.home.empty')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  offlineText: { color: '#92400E' },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { width: '48%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  value: { fontSize: 28, fontWeight: '700' },
  cardLabel: { color: colors.muted },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  empty: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg, alignItems: 'center' },
});
```

`apps/mobile/src/features/profile/profile-screen.tsx`:
```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { session, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

export function ProfileScreen() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const rows: [string, string][] = [
    [t('mobile.profile.role'), me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name],
    [t('mobile.profile.organization'), me.tenant.name],
    [t('mobile.profile.login'), me.user.username ?? me.user.email ?? ''],
  ];
  return (
    <Screen>
      <Text style={styles.name}>{me.user.fullName}</Text>
      {me.user.jobTitle ? <Text style={styles.muted}>{me.user.jobTitle}</Text> : null}
      <View style={styles.card}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton variant="outline" title={t('mobile.profile.changeSecret')} onPress={() => router.push('/change-secret')} />
      <PrimaryButton title={t('mobile.profile.logout')} onPress={() => void session.signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { color: colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
```

`apps/mobile/src/features/profile/change-secret-screen.tsx`:
```tsx
import { ApiError } from '@taskop/api-client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api } from '@/lib/session';

export function ChangeSecretScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [currentSecret, setCurrent] = useState('');
  const [newSecret, setNext] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setFields({});
    if (!currentSecret || !newSecret) {
      setFields({
        ...(currentSecret ? {} : { currentSecret: 'errors.validation.required' }),
        ...(newSecret ? {} : { newSecret: 'errors.validation.required' }),
      });
      return;
    }
    setBusy(true);
    try {
      await api.auth.changeCredential({ currentSecret, newSecret });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>{t('mobile.changeSecret.title')}</Text>
      <Field label={t('mobile.changeSecret.current')} value={currentSecret} onChangeText={setCurrent} secureTextEntry error={fields.currentSecret ? t(fields.currentSecret) : null} />
      <Field label={t('mobile.changeSecret.next')} value={newSecret} onChangeText={setNext} secureTextEntry error={fields.newSecret ? t(fields.newSecret) : null} />
      <FormError message={error} />
      <PrimaryButton title={t('mobile.changeSecret.submit')} onPress={() => void submit()} disabled={busy} />
    </Screen>
  );
}
```

- [ ] **Step 5: Wire up the routes**

Replace `apps/mobile/app/_layout.tsx`:
```tsx
import '@/lib/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { session, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export default function RootLayout() {
  const s = useSession();
  useEffect(() => {
    void session.bootstrap();
  }, []);

  if (s.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={s.status === 'authenticated'}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={s.status === 'anonymous'}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
```

`apps/mobile/app/login.tsx`:
```tsx
import { LoginScreen } from '@/features/auth/login-screen';

export default LoginScreen;
```

`apps/mobile/app/(app)/_layout.tsx`:
```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/lib/theme';

export default function AppLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('mobile.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="change-secret" options={{ href: null }} />
    </Tabs>
  );
}
```

`apps/mobile/app/(app)/index.tsx`:
```tsx
import { HomeScreen } from '@/features/home/home-screen';

export default HomeScreen;
```

`apps/mobile/app/(app)/profile.tsx`:
```tsx
import { ProfileScreen } from '@/features/profile/profile-screen';

export default ProfileScreen;
```

`apps/mobile/app/(app)/change-secret.tsx`:
```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { ChangeSecretScreen } from '@/features/profile/change-secret-screen';

export default function ChangeSecretRoute() {
  const { t } = useTranslation();
  return (
    <ChangeSecretScreen
      onDone={() => {
        Alert.alert(t('mobile.changeSecret.done'));
        router.back();
      }}
    />
  );
}
```
(`@expo/vector-icons` ships with Expo; if the template doesn't list it, run `pnpm --filter @taskop/mobile exec expo install @expo/vector-icons`. The `roles.systemNames.*` keys used on the profile screen come from Part 2 Task W6.)

- [ ] **Step 6: Run tests and type-check**

Run: `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Manual check on a simulator or phone**

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set your LAN IP for a physical phone
pnpm --filter @taskop/mobile dev               # press i (iOS simulator) or a (Android), or scan with Expo Go
```
With the API running and the demo seed loaded: log in as org code `DEMO `, username `Elvin`, PIN `482915` → home greets "Salam, Elvin!". Kill the API, restart the app → home shows the offline banner. Restart the API, change the PIN on Profile → log out → log in with the new PIN.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add worker/staff login, home, profile and PIN change screens"
```
