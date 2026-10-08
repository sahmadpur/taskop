import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SiteNode } from './tree';

interface Props {
  nodes: SiteNode[];
  typeName: (typeId: string) => string;
  canManage: boolean;
  onAddChild: (node: SiteNode) => void;
  onEdit: (node: SiteNode) => void;
  onMove: (node: SiteNode) => void;
  onToggleActive: (node: SiteNode) => void;
}

export function SiteTree(props: Props) {
  return (
    <ul role="tree" className="grid gap-1">
      {props.nodes.map((n) => (
        <SiteTreeItem key={n.id} node={n} {...props} />
      ))}
    </ul>
  );
}

function SiteTreeItem({ node, ...props }: Props & { node: SiteNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined}>
      <div className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5" style={{ paddingLeft: `${node.depth * 20 + 8}px` }}>
        <button
          type="button"
          className="text-muted-foreground size-5"
          aria-label={open ? t('sites.tree.collapse') : t('sites.tree.expand')}
          disabled={!hasChildren}
          onClick={() => setOpen((o) => !o)}
        >
          {hasChildren && (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}
        </button>
        <span className={node.active ? 'font-medium' : 'text-muted-foreground line-through'}>{node.name}</span>
        <Badge variant="outline">{props.typeName(node.typeId)}</Badge>
        {!node.active && <Badge variant="secondary">{t('common.inactive')}</Badge>}
        {props.canManage && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => props.onAddChild(node)}>
              {t('sites.tree.addChild')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onEdit(node)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onMove(node)}>
              {t('sites.tree.move')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onToggleActive(node)}>
              {node.active ? t('common.deactivate') : t('common.reactivate')}
            </Button>
          </div>
        )}
      </div>
      {hasChildren && open && (
        <ul role="group" className="grid gap-1">
          {node.children.map((c) => (
            <SiteTreeItem key={c.id} node={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}
