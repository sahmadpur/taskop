import { type ProblemSeverity, REPORT_FORMATS, type ReportExportKind, type ReportFilters, type ReportFormat, type ReportKind, type RunBucket } from '@taskop/contracts';
import { Download, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, useCan } from '@/lib/session';
import { saveFile } from './download';
import { exportErrorText, exportQuery } from './labels';

/** The full report has no CSV (Part 1 decision 16). */
const FULL_FORMATS: readonly ReportFormat[] = ['xlsx', 'pdf'];

/**
 * Spec §6.2 export menu (reports.view + reports.export): the open table in any format, or the full period report.
 * The file is built synchronously by the API, so the trigger shows a spinner and is disabled meanwhile: one export at
 * a time (decision 14).
 */
export function ExportMenu({ kind, filters, bucket, severity }: { kind: ReportKind; filters: ReportFilters | null; bucket?: RunBucket; severity?: ProblemSeverity }) {
  const { t } = useTranslation();
  const allowed = useCan('reports.view', 'reports.export');
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;

  const download = async (target: ReportExportKind, format: ReportFormat) => {
    if (!filters || busy) return;
    setBusy(true);
    try {
      saveFile(await api.reports.export(target, exportQuery(target, filters, format, { bucket, severity })));
    } catch (e) {
      toast.error(exportErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      {/* Radix opens on pointerdown, which a disabled button still receives: the trigger itself must be disabled too. */}
      <DropdownMenuTrigger asChild disabled={!filters || busy}>
        <Button variant="outline" disabled={!filters || busy} aria-busy={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy ? t('reports.export.preparing') : t('reports.export.menu')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup aria-label={t('reports.export.thisTable')}>
          <DropdownMenuLabel>{t('reports.export.thisTable')}</DropdownMenuLabel>
          {REPORT_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onSelect={() => void download(kind, f)}>
              {t(`reports.export.${f}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label={t('reports.export.fullReport')}>
          <DropdownMenuLabel>{t('reports.export.fullReport')}</DropdownMenuLabel>
          {FULL_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onSelect={() => void download('full', f)}>
              {t(`reports.export.${f}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
