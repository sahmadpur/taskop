import { ApiError } from '@taskop/api-client';
import {
  AUDIT_RESULT_FILTERS,
  type AuditResultFilter,
  LEAD_MINUTES,
  type LeadMinutes,
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPE_META,
  type NotificationRuleDto,
  type RoleDto,
  type UpdateNotificationRuleInput,
} from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckboxList } from '@/components/checkbox-list';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { notificationKeys, useNotificationRules } from './queries';
import { draftOf, type RuleDraft, ruleBody, sameDraft } from './rules-form';

/** Spec §8, FR-15.09: the tenant's rules, grouped Checklist / Problem / Task; each row saves on its own. */
export function NotificationRulesTab() {
  const { t } = useTranslation();
  const rules = useNotificationRules();
  const roles = useRoles();
  if (rules.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (rules.isError) return <p className="text-destructive">{errorText(t, rules.error)}</p>;
  return (
    <div className="grid gap-6">
      <p className="text-muted-foreground text-sm">{t('notifications.rules.intro')}</p>
      {roles.isError && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('notifications.rules.rolesUnavailable')}
        </p>
      )}
      {NOTIFICATION_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`rules-${group}`} className="grid gap-2">
          <h3 id={`rules-${group}`} className="font-medium">
            {t(`notifications.groups.${group}`)}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('notifications.rules.columns.type')}</TableHead>
                <TableHead>{t('notifications.rules.columns.enabled')}</TableHead>
                <TableHead>{t('notifications.channels.push')}</TableHead>
                <TableHead>{t('notifications.channels.email')}</TableHead>
                <TableHead>{t('notifications.audiences.assignees')}</TableHead>
                <TableHead>{t('notifications.audiences.creator')}</TableHead>
                <TableHead>{t('notifications.rules.columns.roles')}</TableHead>
                <TableHead>{t('notifications.rules.columns.leadTime')}</TableHead>
                <TableHead>{t('audits.web.resultFilter')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.data
                .filter((r) => NOTIFICATION_TYPE_META[r.type].group === group)
                .map((r) => (
                  <RuleRow key={r.type} rule={r} roles={roles.isSuccess ? roles.data : null} />
                ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}

/** Field errors carry i18n keys (decision 11); anything else is the API's message. */
function rowError(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.fields && Object.keys(e.fields).length > 0) return Object.values(e.fields).map((k) => t(k)).join(' ');
  return errorText(t, e);
}

function RuleRow({ rule, roles }: { rule: NotificationRuleDto; roles: RoleDto[] | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const meta = NOTIFICATION_TYPE_META[rule.type];
  const typeLabel = t(`notifications.types.${rule.type}`);
  const name = (control: string) => t('notifications.rules.control', { type: typeLabel, control });
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(rule));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** The server's answer replaces the row in the list and becomes the new draft (it may have dropped role ids). */
  const store = (saved: NotificationRuleDto) => {
    qc.setQueryData<NotificationRuleDto[]>(notificationKeys.rules, (list) => list?.map((r) => (r.type === saved.type ? saved : r)));
    setDraft(draftOf(saved));
    setError(null);
  };
  const save = useMutation({
    mutationFn: (body: UpdateNotificationRuleInput) => api.notificationRules.update(rule.type, body),
    onSuccess: (saved) => {
      store(saved);
      toast.success(t('common.saved'));
    },
    onError: (e) => setError(rowError(t, e)),
  });
  const reset = useMutation({
    mutationFn: () => api.notificationRules.reset(rule.type),
    onSuccess: (saved) => {
      store(saved);
      toast.success(t('notifications.rules.resetDone'));
    },
    onError: (e) => setError(rowError(t, e)),
  });
  const busy = save.isPending || reset.isPending;
  const dirty = !sameDraft(draft, draftOf(rule));

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{typeLabel}</span>
          {/* Shown whenever the tenant has an override row (Part 1's isDefault), even one saved with the default values. */}
          {!rule.isDefault && <Badge variant="secondary">{t('notifications.rules.customized')}</Badge>}
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-1 text-sm">
            {error}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Switch aria-label={name(t('notifications.rules.columns.enabled'))} checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} />
      </TableCell>
      <TableCell>
        <Checkbox aria-label={name(t('notifications.channels.push'))} checked={draft.push} onCheckedChange={(v) => set('push', v === true)} />
      </TableCell>
      <TableCell>
        <Checkbox aria-label={name(t('notifications.channels.email'))} checked={draft.email} onCheckedChange={(v) => set('email', v === true)} />
      </TableCell>
      <TableCell>
        {meta.audiences.includes('assignees') ? (
          <Checkbox
            aria-label={name(t('notifications.audiences.assignees'))}
            checked={draft.notifyAssignees}
            onCheckedChange={(v) => set('notifyAssignees', v === true)}
          />
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        {meta.audiences.includes('creator') ? (
          <Checkbox
            aria-label={name(t('notifications.audiences.creator'))}
            checked={draft.notifyCreator}
            onCheckedChange={(v) => set('notifyCreator', v === true)}
          />
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        <RolePicker label={name(t('notifications.rules.columns.roles'))} roles={roles} value={draft.roleIds} onChange={(ids) => set('roleIds', ids)} />
      </TableCell>
      <TableCell>
        {meta.hasLeadTime ? (
          <NativeSelect
            aria-label={name(t('notifications.rules.columns.leadTime'))}
            value={String(draft.leadMinutes ?? '')}
            onChange={(e) => set('leadMinutes', Number(e.target.value) as LeadMinutes)}
            className="w-36"
          >
            {LEAD_MINUTES.map((m) => (
              <option key={m} value={m}>
                {t('notifications.leadMinutes', { count: m })}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        {meta.hasResultFilter ? (
          <NativeSelect
            aria-label={name(t('audits.web.resultFilter'))}
            value={draft.resultFilter ?? ''}
            onChange={(e) => set('resultFilter', e.target.value as AuditResultFilter)}
            className="w-40"
          >
            {AUDIT_RESULT_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`notifications.resultFilters.${f}`)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button size="sm" aria-label={name(t('common.save'))} disabled={!dirty || busy} onClick={() => save.mutate(ruleBody(rule.type, draft))}>
            {t('common.save')}
          </Button>
          {!rule.isDefault && (
            <Button size="sm" variant="outline" aria-label={name(t('notifications.rules.reset'))} disabled={busy} onClick={() => reset.mutate()}>
              {t('notifications.rules.reset')}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Roles whose holders in scope also get the notification. Without GET /roles (no roles.view, decision 10) the button
 * shows how many are chosen and is disabled; the stored ids travel unchanged in the draft.
 */
function RolePicker({ label, roles, value, onChange }: { label: string; roles: RoleDto[] | null; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  if (!roles) {
    return (
      <Button variant="outline" size="sm" aria-label={label} disabled>
        {value.length > 0 ? t('notifications.rules.rolesCount', { count: value.length }) : t('notifications.rules.noRoles')}
      </Button>
    );
  }
  const options = roles.filter((r) => r.active || value.includes(r.id)).map((r) => ({ value: r.id, label: roleDisplayName(t, r) }));
  const names = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="max-w-56 justify-start truncate">
          {names.length > 0 ? names.join(', ') : t('notifications.rules.noRoles')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label={label}>
        <CheckboxList label={t('notifications.rules.columns.roles')} options={options} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
