import { ApiError } from '@taskop/api-client';
import { type AuditDetail, type AuditVerdict, missingVerdicts } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { formatLocalDate } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { AuditActions } from './audit-actions';
import { ItemList } from './item-list';
import { ItemPanel } from './item-panel';
import { auditItems, resultVariant, stepItem, upsertVerdict, verdictMap } from './labels';
import { auditKeys, useAuditDetail } from './queries';
import { ReportPanel } from './report-panel';
import { useLocale } from '@/lib/i18n';
import { LoadingState, EmptyState } from '@/components/states';

/** `/audits/$auditId`. A new id remounts the screen, so selection and drafts never leak between audits. */
export function AuditRoute() {
  const { auditId } = useParams({ strict: false }) as { auditId?: string };
  return <AuditScreen key={auditId} id={auditId!} />;
}

export function AuditScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const { query, timedOut, restartPolling } = useAuditDetail(id);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <p className="text-destructive">{errorText(t, query.error)}</p>;
  return <AuditView audit={query.data} report={{ timedOut, restart: restartPolling }} />;
}

/** Keys typed into a field or a dialog are text, not shortcuts (Global Constraints). */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null;

function AuditView({ audit, report }: { audit: AuditDetail; report: { timedOut: boolean; restart: () => void } }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const canPerform = useCan('audits.perform');
  const canOpenRun = useCan('assignments.view');
  const e = audit.execution;
  const items = useMemo(() => auditItems(e.content, e.answers, audit.auditableItemIds), [e.content, e.answers, audit.auditableItemIds]);
  const order = useMemo(() => items.map((v) => v.item.id), [items]);
  const verdicts = useMemo(() => verdictMap(audit.verdicts), [audit.verdicts]);
  const [selected, setSelected] = useState<string | null>(order[0] ?? null);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [needComment, setNeedComment] = useState<string | null>(null);
  /** Bumped when a rejection needs its comment: the panel answers by focusing the comment box. */
  const [focusComment, setFocusComment] = useState(0);
  const editable = canPerform && audit.status === 'in_progress';
  const missing = missingVerdicts(verdicts, audit.auditableItemIds);
  const total = audit.auditableItemIds.length;
  const reviewed = total - missing.length;
  const current = items.find((v) => v.item.id === selected) ?? items[0] ?? null;
  const commentOf = (itemId: string) => drafts[itemId] ?? audit.verdicts.find((v) => v.itemId === itemId)?.comment ?? '';

  /** Decision 7: point at the items still without a verdict (the client's check, or AUDIT_INCOMPLETE's itemIds). */
  const showMissing = (ids: readonly string[]) => {
    setHighlight(new Set(ids));
    if (ids[0]) setSelected(ids[0]);
  };

  const store = (update: (a: AuditDetail) => AuditDetail) => qc.setQueryData<AuditDetail>(auditKeys.detail(audit.id), (a) => (a ? update(a) : a));
  /** Decision 6: a correction may have hidden the item meanwhile (`fields.itemId = 'audits.issues.notAuditable'`). */
  const onVerdictError = (err: unknown) => {
    toast.error(err instanceof ApiError && err.fields?.itemId ? t(err.fields.itemId) : errorText(t, err));
    void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
  };
  const save = useMutation({
    mutationFn: (v: { itemId: string; verdict: AuditVerdict; comment: string | null }) => api.audits.setVerdict(audit.id, v.itemId, { verdict: v.verdict, comment: v.comment }),
    onSuccess: (v) => {
      store((a) => ({ ...a, verdicts: upsertVerdict(a.verdicts, v) }));
      setHighlight((h) => {
        if (!h.has(v.itemId)) return h;
        const next = new Set(h);
        next.delete(v.itemId);
        return next;
      });
    },
    onError: onVerdictError,
  });
  const clear = useMutation({
    mutationFn: (itemId: string) => api.audits.clearVerdict(audit.id, itemId),
    onSuccess: (_void, itemId) => store((a) => ({ ...a, verdicts: a.verdicts.filter((v) => v.itemId !== itemId) })),
    onError: onVerdictError,
  });

  /** Decision 6: a rejection needs a comment; a sent verdict moves on to the next item at once. */
  const decide = (verdict: AuditVerdict) => {
    if (!current || !editable) return;
    const itemId = current.item.id;
    const comment = commentOf(itemId).trim();
    if (verdict === 'rejected' && !comment) {
      setNeedComment(itemId);
      setFocusComment((n) => n + 1);
      return;
    }
    setNeedComment(null);
    save.mutate({ itemId, verdict, comment: comment || null });
    setSelected(stepItem(order, itemId, 1));
  };

  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setSelected((s) => stepItem(order, s, ev.key === 'ArrowDown' ? 1 : -1));
    } else if (ev.key === 'a' || ev.key === 'A') {
      ev.preventDefault();
      decide('approved');
    } else if (ev.key === 'r' || ev.key === 'R') {
      // Without this, focusing the comment box for a rejection would also type the "r" into it.
      ev.preventDefault();
      decide('rejected');
    }
  });
  useEffect(() => {
    const listener = (ev: KeyboardEvent) => onKey(ev);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const o = e.occurrence;
  return (
    <div className="grid gap-4">
      <PageHeader
        title={o.checklistName}
        actions={
          <>
            {canOpenRun && (
              <Link to="/schedule" search={{ date: o.localDate, occurrence: o.id, tab: 'execution' }} className={buttonVariants({ variant: 'outline' })}>
                {t('audits.web.screen.openRun')}
              </Link>
            )}
            <AuditActions audit={audit} missing={missing} onIncomplete={showMissing} />
          </>
        }
      />
      <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span>{[o.siteName, formatLocalDate(o.localDate, locale), t('audits.web.screen.executor', { name: e.executor.fullName })].join(' · ')}</span>
        <Badge variant="secondary">{t(`audits.statuses.${audit.status}`)}</Badge>
        {audit.result && <Badge variant={resultVariant(audit.result)}>{t(`audits.results.${audit.result}`)}</Badge>}
        {audit.score?.percent != null && (
          <span>
            {t('audits.score')}: {t('executions.percent', { value: formatPercent(audit.score.percent, locale) })}
          </span>
        )}
      </div>
      {audit.paused && (
        <Alert>
          <AlertDescription>{t('audits.paused')}</AlertDescription>
        </Alert>
      )}
      {highlight.size > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('audits.web.screen.missing', { count: highlight.size })}</AlertDescription>
        </Alert>
      )}
      {audit.status === 'finished' && <ReportPanel audit={audit} timedOut={report.timedOut} onRestart={report.restart} />}
      {!canPerform && <EmptyState title={t('audits.web.screen.readOnly')} />}
      <div className="grid gap-1">
        <p id="audit-progress" className="text-sm">
          {t('audits.progress', { reviewed, total })}
        </p>
        <div role="progressbar" aria-labelledby="audit-progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed} className="bg-muted h-2 rounded-full">
          <div className="bg-primary h-2 rounded-full" style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} />
        </div>
      </div>
      {editable && <p className="text-muted-foreground text-xs">{t('audits.web.screen.keyboard')}</p>}
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('audits.web.screen.noItems')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <ItemList content={e.content} items={items} verdicts={verdicts} selected={current?.item.id ?? null} highlight={highlight} onSelect={setSelected} />
          {current && (
            <ItemPanel
              key={current.item.id}
              audit={audit}
              item={current.item}
              verdict={audit.verdicts.find((v) => v.itemId === current.item.id) ?? null}
              comment={commentOf(current.item.id)}
              onComment={(text) => setDrafts((d) => ({ ...d, [current.item.id]: text }))}
              focusComment={focusComment}
              needComment={needComment === current.item.id}
              editable={editable}
              onDecide={decide}
              onClear={() => clear.mutate(current.item.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
