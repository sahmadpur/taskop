/** SP8 spec §7.2. Named AUDIT_JOB_QUEUES: AUDIT_QUEUES is the contracts queue-tab enum. */
export const AUDIT_JOB_QUEUES = { report: 'audit.report', dead: 'audit.dead' } as const;

/** The SP6 worker settings (Global Constraints): five retries, 15 s doubling to at most 240 s, two workers per node. */
export const AUDIT_REPORT_JOB = {
  retryLimit: 5,
  retryDelay: 15,
  retryDelayMax: 240,
  localConcurrency: 2,
  maxAttempts: 5,
  /**
   * One attempt may take: the build (about 10 s for 40 photos, plus loading them) and up to 20 sends, each within the SMTP
   * budget of connection 30 s + greeting 30 s + socket 60 s = 120 s: 20 × 120 s = 2400 s. An hour covers that with margin;
   * pg-boss's default of 15 minutes would expire a slow attempt that is still mailing and run it again beside itself.
   */
  expireInSeconds: 3600,
} as const;

export interface AuditReportJobData {
  tenantId: string;
  auditId: string;
  /** POST /audits/:id/report/send with addresses: send to these instead of the stored recipients. */
  emails?: string[];
}
