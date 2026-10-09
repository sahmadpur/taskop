import type { ShiftDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { useShifts } from './queries';
import { ShiftDialog } from './shift-dialog';

export function ShiftsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('shifts.manage');
  const shifts = useShifts();
  const sites = useSites();
  const [editing, setEditing] = useState<ShiftDto | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['shifts'] });
  const hours = (s: ShiftDto) => `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? ` (${t('scheduling.shifts.nextDay')})` : ''}`;

  return (
    <div>
      <PageHeader title={t('scheduling.shifts.title')} actions={canManage && <Button onClick={() => setEditing('new')}>{t('scheduling.shifts.add')}</Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('scheduling.shifts.name')}</TableHead>
            <TableHead>{t('scheduling.shifts.hours')}</TableHead>
            <TableHead>{t('scheduling.shifts.site')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(shifts.data ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>{hours(s)}</TableCell>
              <TableCell>{s.siteName ?? t('scheduling.shifts.allSites')}</TableCell>
              <TableCell>
                <Badge variant={s.active ? 'default' : 'secondary'}>{s.active ? t('common.active') : t('common.inactive')}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.shifts.update(s.id, { active: !s.active });
                          await refresh();
                        } catch (e) {
                          toast.error(errorText(t, e));
                        }
                      }}
                    >
                      {s.active ? t('common.deactivate') : t('common.reactivate')}
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {shifts.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('scheduling.shifts.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && (
        <ShiftDialog
          shift={editing === 'new' ? undefined : editing}
          sites={sites.data ?? []}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing === 'new') await api.shifts.create(v);
            else {
              // Only send the site when it was changed, so an edit never moves the shift by accident.
              const { siteId, ...rest } = v;
              await api.shifts.update(editing.id, siteId === editing.siteId ? rest : v);
            }
            await refresh();
          }}
        />
      )}
    </div>
  );
}
