import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ChecklistContent, hasRules, type Item, type Section } from '@taskop/contracts';
import { GripVertical, MoveVertical } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IssueIndex } from './issues';
import { MoveToDialog } from './move-to-dialog';
import type { BuilderAction } from './reducer';
import { canMoveTo, type ContainerRef, containerKey, findItem, type NodeRef } from './tree';

export type DragData =
  | { kind: 'section'; sectionId: string; index: number; itemCount: number }
  | { kind: 'item'; itemId: string; container: ContainerRef; index: number }
  | { kind: 'container'; container: ContainerRef; length: number };

/** Turns a drop (active dragged onto over) into a reducer action, or null when not allowed. */
export function dropAction(content: ChecklistContent, active: DragData, over: DragData): BuilderAction | null {
  if (active.kind === 'section') {
    if (over.kind === 'section') return { type: 'moveSection', sectionId: active.sectionId, index: over.index };
    // Dragging a section often hovers a child item or drop slot: resolve its owning section.
    const container = over.container;
    const owner = container.kind === 'section' ? container.sectionId : findItem(content, container.itemId)?.sectionId;
    const index = content.sections.findIndex((s) => s.id === owner);
    if (index < 0 || owner === active.sectionId) return null;
    return { type: 'moveSection', sectionId: active.sectionId, index };
  }
  if (active.kind !== 'item') return null;
  const target =
    over.kind === 'item'
      ? { container: over.container, index: over.index }
      : over.kind === 'container'
        ? { container: over.container, index: over.length }
        : { container: { kind: 'section', sectionId: over.sectionId } as ContainerRef, index: over.itemCount };
  if (!canMoveTo(content, active.itemId, target.container)) return null;
  return { type: 'moveItem', itemId: active.itemId, to: target.container, index: target.index };
}

interface OutlineProps {
  content: ChecklistContent;
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
}

export function Outline({ content, selected, issues, dispatch, readOnly }: OutlineProps) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState<Exclude<NodeRef, { kind: 'settings' }> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DragData | undefined;
    if (!a || !o || e.active.id === e.over?.id) return;
    const action = dropAction(content, a, o);
    if (action) dispatch(action);
  };
  const ctx: NodeCtx = { selected, issues, dispatch, readOnly, onMove: setMoving };

  return (
    <nav aria-label={t('checklists.builder.outline')} className="flex min-h-0 flex-col gap-1 overflow-y-auto rounded-md border p-2 text-sm">
      <button
        type="button"
        className={cn('rounded px-2 py-1 text-left font-medium hover:bg-slate-100', selected.kind === 'settings' && 'bg-slate-100')}
        onClick={() => dispatch({ type: 'select', node: { kind: 'settings' } })}
      >
        {t('checklists.builder.settings')}
      </button>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={content.sections.map((s) => `s:${s.id}`)} strategy={verticalListSortingStrategy}>
          <ul role="tree" className="grid gap-1">
            {content.sections.map((s, index) => (
              <SectionNode key={s.id} section={s} index={index} ctx={ctx} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => dispatch({ type: 'addSection' })}>
          + {t('checklists.builder.addSection')}
        </Button>
      )}
      {moving && <MoveToDialog content={content} node={moving} onClose={() => setMoving(null)} onMove={dispatch} />}
    </nav>
  );
}

interface NodeCtx {
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
  onMove: (node: Exclude<NodeRef, { kind: 'settings' }>) => void;
}

function NodeRow(props: {
  label: string;
  selected: boolean;
  issueCount: number;
  onSelect: () => void;
  onMove: () => void;
  handle: ReactNode;
  readOnly: boolean;
  bold?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('group flex items-center gap-1 rounded px-1', props.selected && 'bg-slate-100')}>
      {!props.readOnly && props.handle}
      <button type="button" className={cn('min-w-0 flex-1 truncate py-1 text-left', props.bold && 'font-medium')} onClick={props.onSelect}>
        {props.label}
      </button>
      {props.issueCount > 0 && (
        <span className="bg-destructive/10 text-destructive rounded px-1 text-xs" aria-hidden>
          {props.issueCount}
        </span>
      )}
      {!props.readOnly && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-60 group-hover:opacity-100"
          aria-label={`${t('checklists.builder.moveTo')} — ${props.label}`}
          title={t('checklists.builder.moveTo')}
          onClick={props.onMove}
        >
          <MoveVertical className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function DragHandle({ attributes, listeners }: Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>) {
  const { t } = useTranslation();
  return (
    <button type="button" className="text-muted-foreground cursor-grab touch-none" aria-label={t('checklists.builder.dragHandle')} {...attributes} {...listeners}>
      <GripVertical className="size-3.5" />
    </button>
  );
}

function SectionNode({ section, index, ctx }: { section: Section; index: number; ctx: NodeCtx }) {
  const { t } = useTranslation();
  const s = useSortable({ id: `s:${section.id}`, data: { kind: 'section', sectionId: section.id, index, itemCount: section.items.length } satisfies DragData, disabled: ctx.readOnly });
  const label = section.title || t('checklists.builder.untitledSection');
  const isSelected = ctx.selected.kind === 'section' && ctx.selected.id === section.id;
  return (
    // eslint-disable-next-line react-hooks/refs -- dnd-kit ref callbacks are misread as ref reads
    <li ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} role="treeitem" aria-label={label} aria-selected={isSelected} aria-expanded>
      <NodeRow
        label={label}
        bold
        selected={isSelected}
        issueCount={ctx.issues.byNode.get(section.id)?.length ?? 0}
        onSelect={() => ctx.dispatch({ type: 'select', node: { kind: 'section', id: section.id } })}
        onMove={() => ctx.onMove({ kind: 'section', id: section.id })}
        // eslint-disable-next-line react-hooks/refs -- dnd-kit ref callbacks are misread as ref reads
        handle={<DragHandle attributes={s.attributes} listeners={s.listeners} />}
        readOnly={ctx.readOnly}
      />
      <ItemList container={{ kind: 'section', sectionId: section.id }} items={section.items} ctx={ctx} />
    </li>
  );
}

function ItemList({ container, items, ctx }: { container: ContainerRef; items: Item[]; ctx: NodeCtx }) {
  const drop = useDroppable({ id: `c:${containerKey(container)}`, data: { kind: 'container', container, length: items.length } satisfies DragData, disabled: ctx.readOnly });
  return (
    <SortableContext items={items.map((i) => `i:${i.id}`)} strategy={verticalListSortingStrategy}>
      <ul role="group" className="ml-3 grid gap-0.5 border-l pl-2">
        {items.map((item, index) => (
          <ItemNode key={item.id} item={item} index={index} container={container} ctx={ctx} />
        ))}
        {/* eslint-disable-next-line react-hooks/refs -- dnd-kit ref callbacks are misread as ref reads */}
        <li ref={drop.setNodeRef} aria-hidden className={cn('h-1.5 rounded', drop.isOver && 'bg-primary/30')} />
      </ul>
    </SortableContext>
  );
}

function ItemNode({ item, index, container, ctx }: { item: Item; index: number; container: ContainerRef; ctx: NodeCtx }) {
  const { t } = useTranslation();
  const s = useSortable({ id: `i:${item.id}`, data: { kind: 'item', itemId: item.id, container, index } satisfies DragData, disabled: ctx.readOnly });
  const label = item.label || t('checklists.builder.untitledItem');
  const isSelected = ctx.selected.kind === 'item' && ctx.selected.id === item.id;
  return (
    // eslint-disable-next-line react-hooks/refs -- dnd-kit ref callbacks are misread as ref reads
    <li ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} role="treeitem" aria-label={label} aria-selected={isSelected}>
      <NodeRow
        label={label}
        selected={isSelected}
        issueCount={ctx.issues.byNode.get(item.id)?.length ?? 0}
        onSelect={() => ctx.dispatch({ type: 'select', node: { kind: 'item', id: item.id } })}
        onMove={() => ctx.onMove({ kind: 'item', id: item.id })}
        // eslint-disable-next-line react-hooks/refs -- dnd-kit ref callbacks are misread as ref reads
        handle={<DragHandle attributes={s.attributes} listeners={s.listeners} />}
        readOnly={ctx.readOnly}
      />
      {hasRules(item) &&
        item.rules.map((rule, n) =>
          rule.then.followUps.length > 0 ? (
            <div key={rule.id} className="ml-3">
              <span className="text-muted-foreground text-xs">{t('checklists.builder.rules.ruleN', { n: n + 1 })}</span>
              <ItemList container={{ kind: 'rule', itemId: item.id, ruleId: rule.id }} items={rule.then.followUps} ctx={ctx} />
            </div>
          ) : null,
        )}
    </li>
  );
}
