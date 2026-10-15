/** SP8 spec §7.2. Named AUDIT_JOB_QUEUES: AUDIT_QUEUES is the contracts queue-tab enum. */
export const AUDIT_JOB_QUEUES = { report: 'audit.report', dead: 'audit.dead' } as const;

/** The SP6 worker settings (Global Constraints): five retries, 15 s doubling to at most 240 s, two workers per node. */
export const AUDIT_REPORT_JOB = { retryLimit: 5, retryDelay: 15, retryDelayMax: 240, localConcurrency: 2, maxAttempts: 5 } as const;

export interface AuditReportJobData {
  tenantId: string;
  auditId: string;
  /** POST /audits/:id/report/send with addresses: send to these instead of the stored recipients. */
  emails?: string[];
}
