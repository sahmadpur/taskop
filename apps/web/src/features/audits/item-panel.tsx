import { AUDIT_LIMITS, type AuditDetail, type AuditItemVerdict, type AuditVerdict, type ExecutionMediaDto, type Item } from '@taskop/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { answerValue, severityVariant } from '@/features/executions/labels';
import { MediaLightbox, MediaStrip } from '@/features/executions/media';
import { useFormatDateTime } from '@/lib/format';
import { actorName } from './labels';
import { useLocale } from '@/lib/i18n';

/**
 * The right panel (spec §8.3): the question, the answer (with an "İlkin" toggle when the item was corrected), its
 * photos and videos in the existing viewer, its active problems, and the verdict with its comment.
 */
export function ItemPanel(props: {
  audit: AuditDetail;
  item: Item;
  verdict: AuditItemVerdict | null;
  comment: string;
  onComment: (text: string) => void;
  /** A counter: each increase asks the panel to put the cursor in the comment box. */
  focusComment: number;
  needComment: boolean;
  editable: boolean;
  onDecide: (verdict: AuditVerdict) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const formatDateTime = useFormatDateTime();
  const [showOriginal, setShowOriginal] = useState(false);
  const [open, setOpen] = useState<ExecutionMediaDto | null>(null);
  const e = props.audit.execution;
  const media = useMemo(() => new Map(e.media.map((m) => [m.id, m])), [e.media]);
  const { item } = props;
  const diff = props.audit.corrections.diff.find((d) => d.itemId === item.id) ?? null;
  const lastCorrection = props.audit.corrections.corrections.findLast((c) => c.itemId === item.id) ?? null;
  const answer = diff && showOriginal ? (diff.original ?? undefined) : e.answers[item.id];
  const value = answerValue(t, item, answer, formatDateTime, locale);
  const evidence = [...(answer?.photos ?? []), ...(answer?.videos ?? [])];
  const note = answer?.note?.trim();
  const problems = e.problems.filter((p) => p.itemId === item.id && p.clearedAt === null);
  const commentBox = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(props.focusComment);
  useEffect(() => {
    if (props.focusComment === focused.current) return;
    focused.current = props.focusComment;
    commentBox.current?.focus();
  }, [props.focusComment]);
  const titleId = `audit-item-${item.id}`;

  return (
    <section aria-labelledby={titleId} className="grid content-start gap-4 bg-card shadow-card rounded-xl p-4">
      <header className="grid gap-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {item.label}
        </h2>
        {item.helpText && <p className="text-muted-foreground text-sm">{item.helpText}</p>}
      </header>

      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{diff ? t(showOriginal ? 'corrections.original' : 'corrections.current') : t('audits.web.screen.answer')}</h3>
          {diff && (
            <Button size="sm" variant="outline" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
              {t('corrections.original')}
            </Button>
          )}
        </div>
        {value !== null ? <p>{value}</p> : evidence.length === 0 && <p className="text-muted-foreground">{t('executions.notAnswered')}</p>}
        {note && <p className="text-muted-foreground text-sm">{t('executions.note', { note })}</p>}
        {lastCorrection && (
          <p className="text-muted-foreground text-xs">{t('audits.web.screen.correctedBy', { name: actorName(t, lastCorrection.actor), reason: lastCorrection.reason })}</p>
        )}
      </div>

      {evidence.length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('audits.web.screen.media')}</h3>
          <MediaStrip ids={evidence} media={media} onOpen={setOpen} />
        </div>
      )}

      {problems.length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('audits.web.screen.problems')}</h3>
          {problems.map((p) => (
            <div key={p.id} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                <span className="text-muted-foreground text-xs">{t(`executions.problemSources.${p.source}`)}</span>
              </div>
              {p.note && <p className="text-sm whitespace-pre-line">{p.note}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 border-t pt-3">
        {props.verdict && (
          <p className="text-sm">
            {props.verdict.updatedBy
              ? t('audits.web.screen.verdictBy', { verdict: t(`audits.verdicts.${props.verdict.verdict}`), name: props.verdict.updatedBy.fullName })
              : t(`audits.verdicts.${props.verdict.verdict}`)}
          </p>
        )}
        {props.editable ? (
          <>
            <Label htmlFor="verdict-comment">{t('audits.fields.comment')}</Label>
            <Textarea
              id="verdict-comment"
              ref={commentBox}
              value={props.comment}
              maxLength={AUDIT_LIMITS.verdictComment}
              aria-invalid={props.needComment}
              onChange={(ev) => props.onComment(ev.target.value)}
            />
            {props.needComment && <p className="text-destructive text-sm">{t('audits.issues.commentRequired')}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => props.onDecide('approved')}>{t('audits.actions.approve')}</Button>
              <Button variant="destructive" onClick={() => props.onDecide('rejected')}>
                {t('audits.actions.reject')}
              </Button>
              {props.verdict && (
                <Button variant="ghost" onClick={props.onClear}>
                  {t('audits.actions.clearVerdict')}
                </Button>
              )}
            </div>
          </>
        ) : (
          props.verdict?.comment && <p className="text-sm whitespace-pre-line">{props.verdict.comment}</p>
        )}
      </div>
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
