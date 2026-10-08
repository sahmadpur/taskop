import type { ChecklistContent } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { BuilderAction } from './reducer';
import { canMoveTo, containerItems, containerKey, findItem, listContainers, type NodeRef } from './tree';

interface Props {
  content: ChecklistContent;
  node: Exclude<NodeRef, { kind: 'settings' }>;
  onClose: () => void;
  onMove: (action: BuilderAction) => void;
}

export function MoveToDialog({ content, node, onClose, onMove }: Props) {
  const { t } = useTranslation();
  const found = node.kind === 'item' ? findItem(content, node.id) : null;
  const targets = node.kind === 'item' ? listContainers(content).filter((c) => canMoveTo(content, node.id, c.ref)) : [];
  const [targetKey, setTargetKey] = useState(found ? containerKey(found.container) : '');
  const currentIndex = node.kind === 'section' ? content.sections.findIndex((s) => s.id === node.id) : (found?.index ?? 0);
  const [position, setPosition] = useState(currentIndex + 1);

  const target = targets.find((c) => c.key === targetKey);
  const slots =
    node.kind === 'section'
      ? content.sections.length
      : (containerItems(content, target?.ref ?? found!.container)?.length ?? 0) + (target && found && target.key === containerKey(found.container) ? 0 : 1);

  const submit = () => {
    if (node.kind === 'section') onMove({ type: 'moveSection', sectionId: node.id, index: position - 1 });
    else if (target) onMove({ type: 'moveItem', itemId: node.id, to: target.ref, index: position - 1 });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('checklists.builder.moveTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {node.kind === 'item' && (
            <div className="grid gap-1.5">
              <Label htmlFor="move-target">{t('checklists.builder.target')}</Label>
              <NativeSelect
                id="move-target"
                value={targetKey}
                onChange={(e) => {
                  setTargetKey(e.target.value);
                  setPosition(1);
                }}
              >
                {targets.map((c) => (
                  <option key={c.key} value={c.key}>
                    {'  '.repeat(c.depth)}
                    {c.ownerLabel === null
                      ? t('checklists.builder.sectionTarget', { title: c.sectionTitle || t('checklists.builder.untitledSection') })
                      : t('checklists.builder.followUpsOf', { label: c.ownerLabel || t('checklists.builder.untitledItem'), n: c.ruleNo })}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="move-position">{t('checklists.builder.position')}</Label>
            <NativeSelect id="move-position" value={String(position)} onChange={(e) => setPosition(Number(e.target.value))}>
              {Array.from({ length: Math.max(slots, 1) }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit}>{t('checklists.builder.moveTitle')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
