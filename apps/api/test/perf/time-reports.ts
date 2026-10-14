/**
 * SP7 spec §9 performance check against a running API on the seeded "perf" tenant:
 *   pnpm --filter @taskop/api db:seed-report-volume
 *   pnpm --filter @taskop/api dev                      (another terminal)
 *   pnpm --filter @taskop/api perf:reports [baseUrl]
 * Prints the median of 5 timed runs (after one warm-up) per endpoint, range and principal; exits 1 when any 366-day
 * median is at or above the 500 ms target.
 */
import { addDays, localDateOf } from '@taskop/contracts';

const BASE = process.argv[2] ?? 'http://localhost:3000/api/v1';
const TARGET_MS = 500;
const RUNS = 5;
const RANGES = [7, 31, 366];
const ENDPOINTS = ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks'];
const PASSWORD = 'PerfPassword123';

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login/staff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, client: 'web' }) });
  if (!res.ok) throw new Error(`Login ${email} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function timed(token: string, path: string): Promise<number> {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return performance.now() - started;
}

async function main(): Promise<void> {
  const today = localDateOf(new Date(), 'Asia/Baku');
  const principals: [string, string][] = [
    ['all', await login('perf-owner@taskop.test')],
    ['site_subtree', await login('perf-manager@taskop.test')],
  ];
  const rows: { scope: string; days: number; endpoint: string; medianMs: number }[] = [];
  for (const [scope, token] of principals) {
    for (const days of RANGES) {
      for (const endpoint of ENDPOINTS) {
        const path = `/reports/${endpoint}?from=${addDays(today, 1 - days)}&to=${today}`;
        await timed(token, path);
        const samples: number[] = [];
        for (let i = 0; i < RUNS; i++) samples.push(await timed(token, path));
        samples.sort((a, b) => a - b);
        rows.push({ scope, days, endpoint, medianMs: Math.round(samples[Math.floor(RUNS / 2)]!) });
      }
    }
  }
  console.table(rows);
  const slow = rows.filter((r) => r.days === 366 && r.medianMs >= TARGET_MS);
  if (slow.length) {
    console.error(`Over the ${TARGET_MS} ms target at 366 days: ${slow.map((r) => `${r.scope} ${r.endpoint} ${r.medianMs} ms`).join(', ')}`);
    process.exit(1);
  }
  console.log(`Every endpoint is under ${TARGET_MS} ms at 366 days.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
