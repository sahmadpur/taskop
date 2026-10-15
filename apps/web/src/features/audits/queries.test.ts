import { describe, expect, it, vi } from 'vitest';
import { apiError, AUDIT_IDS, auditDto } from './fixtures';
import { startOrOpenAudit } from './queries';

const mocks = vi.hoisted(() => ({ api: { audits: { start: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

describe('startOrOpenAudit', () => {
  it('returns the new audit, or the one another auditor started first', async () => {
    mocks.api.audits.start.mockResolvedValueOnce(auditDto({ id: AUDIT_IDS.audit }));
    expect(await startOrOpenAudit(AUDIT_IDS.execution)).toBe(AUDIT_IDS.audit);
    expect(mocks.api.audits.start).toHaveBeenCalledWith(AUDIT_IDS.execution);
    mocks.api.audits.start.mockRejectedValueOnce(apiError(409, 'AUDIT_EXISTS', { auditId: AUDIT_IDS.audit2 }));
    expect(await startOrOpenAudit(AUDIT_IDS.execution)).toBe(AUDIT_IDS.audit2);
  });

  it('passes every other refusal on', async () => {
    mocks.api.audits.start.mockRejectedValueOnce(apiError(409, 'EXECUTION_LOCKED'));
    await expect(startOrOpenAudit(AUDIT_IDS.execution)).rejects.toMatchObject({ code: 'EXECUTION_LOCKED' });
  });
});
