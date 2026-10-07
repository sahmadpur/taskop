import { useTranslation } from 'react-i18next';

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function diffEntries(before: unknown, after: unknown) {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, before: b[k], after: a[k] }));
}

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));

export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation();
  const rows = diffEntries(before, after);
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{t('audit.noChanges')}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-4 font-normal" />
          <th className="py-1 pr-4 font-normal">{t('audit.before')}</th>
          <th className="py-1 font-normal">{t('audit.after')}</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((r) => (
          <tr key={r.key} className="border-t align-top">
            <td className="py-1 pr-4 font-sans font-medium">{r.key}</td>
            <td className="py-1 pr-4 break-all text-red-700">{show(r.before)}</td>
            <td className="py-1 break-all text-green-700">{show(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
