import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emailSchema = z.email();

/** Typed or pasted text as addresses: commas, semicolons, spaces and new lines separate them; lower-cased like the API. */
export const splitEmails = (raw: string): string[] =>
  raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export type EmailListIssue = 'invalid' | 'duplicate' | 'tooMany';

/** The list after adding `raw`, or why nothing was added: all or nothing, so half a paste never slips in. */
export function addEmails(current: readonly string[], raw: string, max: number): { ok: true; next: string[] } | { ok: false; issue: EmailListIssue } {
  const next = [...current];
  for (const e of splitEmails(raw)) {
    if (!emailSchema.safeParse(e).success) return { ok: false, issue: 'invalid' };
    if (next.includes(e)) return { ok: false, issue: 'duplicate' };
    if (next.length >= max) return { ok: false, issue: 'tooMany' };
    next.push(e);
  }
  return { ok: true, next };
}

/**
 * A tag input for e-mail addresses (spec §8.3: the checklist's report list, the auditor's extra addresses). Enter, a
 * comma, the button or leaving the field adds what is typed; a refused entry stays in the field with the reason.
 */
export function EmailListInput(props: {
  id: string;
  label: string;
  hint?: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [issue, setIssue] = useState<EmailListIssue | null>(null);
  const hintId = `${props.id}-hint`;
  const errorId = `${props.id}-error`;

  const commit = (raw = text) => {
    if (!raw.trim()) return;
    const r = addEmails(props.value, raw, props.max);
    if (!r.ok) {
      setText(raw);
      setIssue(r.issue);
      return;
    }
    setIssue(null);
    setText('');
    props.onChange(r.next);
  };

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {props.value.map((e) => (
            <li key={e} className="bg-secondary flex items-center gap-1 rounded-md px-2 py-0.5 text-sm">
              {e}
              {!props.disabled && (
                <button
                  type="button"
                  aria-label={t('audits.web.emails.remove', { email: e })}
                  className="hover:text-destructive"
                  onClick={() => props.onChange(props.value.filter((x) => x !== e))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.disabled ? (
        props.value.length === 0 && <p className="text-muted-foreground text-sm">{t('audits.web.emails.none')}</p>
      ) : (
        <div className="flex gap-2">
          {/* type="text": an email input would trim and reject a pasted list before it is split. */}
          <Input
            id={props.id}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={text}
            placeholder={t('audits.web.emails.placeholder')}
            aria-invalid={issue !== null}
            aria-describedby={[props.hint ? hintId : null, issue ? errorId : null].filter(Boolean).join(' ') || undefined}
            onChange={(e) => {
              setText(e.target.value);
              setIssue(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={() => commit()}
            onPaste={(e) => {
              // A single-line input strips new lines from a paste, which would glue the addresses together: split it ourselves.
              const pasted = e.clipboardData.getData('text');
              if (!pasted) return;
              e.preventDefault();
              const { selectionStart, selectionEnd } = e.currentTarget;
              commit((text.slice(0, selectionStart ?? text.length) + pasted + text.slice(selectionEnd ?? text.length)).trim());
            }}
          />
          <Button type="button" variant="outline" onClick={() => commit()}>
            {t('audits.web.emails.add')}
          </Button>
        </div>
      )}
      {props.hint && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {props.hint}
        </p>
      )}
      {issue && (
        <p id={errorId} className="text-destructive text-sm">
          {t(`audits.web.emails.${issue}`, { max: props.max })}
        </p>
      )}
    </div>
  );
}
