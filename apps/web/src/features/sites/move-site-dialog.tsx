import type { SiteDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { indentedName, moveTargets } from './tree';

interface Props {
  site: SiteDto;
  sites: SiteDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (parentId: string | null) => void;
}

export function MoveSiteDialog({ site, sites, open, onOpenChange, onMove }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(site.parentId ?? '');
  const options = moveTargets(sites, site.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sites.tree.moveTitle', { name: site.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="move-target">{t('sites.tree.moveTarget')}</Label>
          <NativeSelect id="move-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('sites.tree.root')}</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {indentedName(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onMove(target || null)}>{t('sites.tree.move')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
