import type { AuditVerdict, ChecklistContent, VisibleItem } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { verdictVariant } from './labels';

/** The left column (spec §8.3): the items under review by section, follow-ups indented, each with its verdict chip. */
export function ItemList(props: {
  content: ChecklistContent;
  items: readonly VisibleItem[];
  verdicts: ReadonlyMap<string, AuditVerdict>;
  selected: string | null;
  highlight: ReadonlySet<string>;
  onSelect: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('audits.web.screen.items')} className="grid content-start gap-3">
      {props.content.sections.map((s) => {
        const rows = props.items.filter((v) => v.sectionId === s.id);
        if (rows.length === 0) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-1">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">{s.title}</h3>
            <ol className="grid gap-1">
              {rows.map((v) => {
                const verdict = props.verdicts.get(v.item.id) ?? null;
                const current = props.selected === v.item.id;
                const missing = props.highlight.has(v.item.id);
                return (
                  <li key={v.item.id}>
                    <button
                      type="button"
                      aria-label={v.item.label}
                      aria-describedby={`verdict-${v.item.id}`}
                      aria-current={current ? 'true' : undefined}
                      data-verdict={verdict ?? 'none'}
                      data-missing={missing ? 'true' : undefined}
                      onClick={() => props.onSelect(v.item.id)}
                      style={{ paddingLeft: 8 + v.depth * 16 }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border py-1.5 pr-2 text-left text-sm',
                        current && 'border-primary bg-accent',
                        missing && 'border-destructive',
                      )}
                    >
                      <span className="truncate">{v.item.label}</span>
                      {/* The chip describes the button, so a screen reader hears the item and then its verdict. */}
                      <Badge id={`verdict-${v.item.id}`} variant={verdictVariant(verdict)}>
                        {verdict ? t(`audits.verdicts.${verdict}`) : t('audits.verdicts.unreviewed')}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </nav>
  );
}
