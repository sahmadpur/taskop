import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ChecklistDetail } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorText } from '@/lib/errors';

export interface AuditSettingsValue {
  requiresAudit: boolean;
  auditReportEmails: string[];
}

/**
 * The checklist's audit settings (spec §4.1, §8.3, decision 15): completed runs go to the audit queue, and the finished
 * audit's PDF goes to these addresses. Settings, not versioned content: they apply from the next completed run.
 */
export function AuditSettings({ checklist, editable, onSave }: { checklist: ChecklistDetail; editable: boolean; onSave: (v: AuditSettingsValue) => Promise<void> }) {
  const { t } = useTranslation();
  const [requiresAudit, setRequiresAudit] = useState(checklist.requiresAudit);
  const [emails, setEmails] = useState<string[]>(checklist.auditReportEmails);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = requiresAudit !== checklist.requiresAudit || emails.join('\n') !== checklist.auditReportEmails.join('\n');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ requiresAudit, auditReportEmails: emails });
    } catch (e) {
      // Part 1: `fields.auditReportEmails` (too many) or `fields['auditReportEmails.<i>']` (one bad address).
      const key = e instanceof ApiError && e.fields ? Object.entries(e.fields).find(([field]) => field === 'auditReportEmails' || field.startsWith('auditReportEmails.'))?.[1] : undefined;
      setError(key ? t(key) : errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="audit-settings-title" className="grid max-w-xl gap-3 bg-card shadow-card rounded-xl p-4">
      <h2 id="audit-settings-title" className="text-lg font-semibold">
        {t('audits.web.settings.title')}
      </h2>
      <div className="flex items-start gap-3">
        <Switch id="requires-audit" checked={requiresAudit} disabled={!editable} onCheckedChange={setRequiresAudit} aria-describedby="requires-audit-hint" />
        <div className="grid gap-0.5">
          <Label htmlFor="requires-audit">{t('audits.fields.requiresAudit')}</Label>
          <p id="requires-audit-hint" className="text-muted-foreground text-xs">
            {t('audits.web.settings.requiresAuditHint')}
          </p>
        </div>
      </div>
      <EmailListInput
        id="audit-report-emails"
        label={t('audits.fields.reportEmails')}
        hint={t('audits.web.settings.emailsHint')}
        value={emails}
        onChange={setEmails}
        max={AUDIT_LIMITS.reportEmails}
        disabled={!editable}
      />
      <FormError message={error} />
      {editable && (
        <Button className="w-fit" disabled={!dirty || busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      )}
    </section>
  );
}
