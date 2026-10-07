import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function SecretBlock({ orgCode, username, secret }: { orgCode: string; username: string; secret: string }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('users.secret.orgCode'), orgCode],
    [t('users.secret.username'), username],
    [t('users.secret.secret'), secret],
  ];
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">{t('users.secret.body')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md border p-4 font-mono text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground font-sans">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(rows.map(([l, v]) => `${l}: ${v}`).join('\n'));
          toast.success(t('common.copied'));
        }}
      >
        <Copy className="size-4" /> {t('common.copy')}
      </Button>
    </div>
  );
}
