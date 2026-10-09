import { type Answer, type Answers, type ChecklistContent, type ExecutionMediaDto, type ExecutionProblem, type Item, visibleItems } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useFormatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { answerValue, severityVariant } from './labels';
import { MediaLightbox, MediaStrip } from './media';

/**
 * Answers in the pinned version's layout (spec §8): only items visible for these answers, in order, follow-ups
 * indented. An answer to a follow-up that the final answers hide was never part of the result, so it is not shown.
 */
export function AnswersView(props: { content: ChecklistContent; answers: Answers; media: ExecutionMediaDto[]; problems: ExecutionProblem[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ExecutionMediaDto | null>(null);
  const media = useMemo(() => new Map(props.media.map((m) => [m.id, m])), [props.media]);
  const visible = useMemo(() => visibleItems(props.content, props.answers), [props.content, props.answers]);

  if (Object.keys(props.answers).length === 0) return <p className="text-muted-foreground">{t('executions.noAnswers')}</p>;

  return (
    <div className="grid gap-4">
      {props.content.sections.map((s) => {
        const rows = visible.filter((v) => v.sectionId === s.id);
        if (!rows.length) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-2">
            <h4 className="font-semibold">{s.title}</h4>
            <ol className="grid gap-2">
              {rows.map((v) => (
                <AnswerRow
                  key={v.item.id}
                  item={v.item}
                  depth={v.depth}
                  answer={props.answers[v.item.id]}
                  problems={props.problems.filter((p) => p.itemId === v.item.id)}
                  media={media}
                  onOpen={setOpen}
                />
              ))}
            </ol>
          </section>
        );
      })}
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AnswerRow(props: {
  item: Item;
  depth: number;
  answer: Answer | undefined;
  problems: ExecutionProblem[];
  media: ReadonlyMap<string, ExecutionMediaDto>;
  onOpen: (m: ExecutionMediaDto) => void;
}) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const { item, answer, problems } = props;
  const value = answerValue(t, item, answer, formatDateTime);
  const evidence = [...(answer?.photos ?? []), ...(answer?.videos ?? [])];
  const worst = problems.some((p) => p.severity === 'critical') ? 'critical' : problems.length ? 'normal' : undefined;
  const note = answer?.note?.trim();

  return (
    <li
      aria-label={item.label}
      data-depth={props.depth}
      data-problem={worst}
      style={{ marginLeft: props.depth * 16 }}
      className={cn(
        'grid gap-1.5 rounded-md border p-2',
        worst === 'critical' && 'border-destructive bg-destructive/5',
        worst === 'normal' && 'border-amber-500 bg-amber-50',
      )}
    >
      <span className="font-medium">{item.label}</span>
      {value !== null ? <span>{value}</span> : evidence.length === 0 && <span className="text-muted-foreground">{t('executions.notAnswered')}</span>}
      {/* A rule problem's media are these same photos and videos, so they are shown once, here. */}
      <MediaStrip ids={evidence} media={props.media} onOpen={props.onOpen} />
      {note && <p className="text-muted-foreground">{t('executions.note', { note })}</p>}
      {problems.map((p) => (
        <div key={p.id} className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
            <span className="text-muted-foreground text-xs">{t(`executions.problemSources.${p.source}`)}</span>
          </div>
          {p.source === 'manual' && p.note && <p className="whitespace-pre-line">{p.note}</p>}
          {/* A manual problem may attach the item's own evidence: show only what is not already shown above. */}
          {p.source === 'manual' && <MediaStrip ids={p.mediaIds.filter((id) => !evidence.includes(id))} media={props.media} onOpen={props.onOpen} />}
        </div>
      ))}
    </li>
  );
}
