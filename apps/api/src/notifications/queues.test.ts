import { describe, expect, it } from 'vitest';
import { deliveryJobs } from './queues';

describe('deliveryJobs', () => {
  it('batches push deliveries by 100 and sends each email on its own', () => {
    const push = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, channel: 'push' as const }));
    const jobs = deliveryJobs('t1', [...push, { id: 'e1', channel: 'email' }, { id: 'e2', channel: 'email' }]);
    expect(jobs.map((j) => j.deliveryIds.length)).toEqual([100, 100, 50, 1, 1]);
    expect(jobs.every((j) => j.tenantId === 't1')).toBe(true);
    expect(jobs.at(-1)!.deliveryIds).toEqual(['e2']);
    expect(deliveryJobs('t1', [])).toEqual([]);
  });
});
