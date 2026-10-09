import { type ChecklistContent, type ContentSaveResult, validateForPublish } from '@taskop/contracts';
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Canvas } from './canvas';
import { Inspector } from './inspector';
import { indexIssues } from './issues';
import { Outline } from './outline';
import { PreviewPane } from './preview';
import { builderReducer, initialState } from './reducer';
import { useAutosave } from './use-autosave';

export interface BuilderProps {
  title: string;
  badge?: ReactNode;
  /** Extra header actions (e.g. publish/unpublish for global templates). */
  actions?: ReactNode;
  initialContent: ChecklistContent;
  initialRevision: number;
  readOnly: boolean;
  save?: (content: ChecklistContent, revision: number) => Promise<ContentSaveResult>;
  /** Present only when the user may publish (checklist drafts). */
  onPublish?: (revision: number, changeNote: string | null) => Promise<void>;
  onReload?: () => void;
  onBack: () => void;
}

export function Builder(props: BuilderProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(builderReducer, props.initialContent, initialState);
  const autosave = useAutosave({
    content: state.content,
    version: state.version,
    initialRevision: props.initialRevision,
    save: props.readOnly ? undefined : props.save,
  });
  const issues = useMemo(() => validateForPublish(state.content), [state.content]);
  const index = useMemo(() => indexIssues(state.content, issues), [state.content, issues]);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const readOnly = props.readOnly || autosave.status === 'conflict';

  // Keyboard undo/redo only while the canvas is editable: not read-only, not blocked by a conflict,
  // and not behind the preview or the publish dialog.
  const keyboardHistory = !readOnly && !preview && !publishing;
  useEffect(() => {
    if (!keyboardHistory) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardHistory]);

  const saveLabel = {
    saved: t('checklists.builder.save.saved'),
    dirty: t('checklists.builder.save.dirty'),
    saving: t('checklists.builder.save.saving'),
    error: t('checklists.builder.save.error'),
    conflict: t('checklists.builder.save.conflict'),
  }[autosave.status];

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeft className="size-4" /> {t('common.back')}
        </Button>
        <h1 className="text-xl font-semibold">{props.title}</h1>
        {props.badge}
        {props.readOnly && <Badge variant="secondary">{t('checklists.builder.readOnly')}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!props.readOnly && (
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {saveLabel}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={issues.length ? 'destructive' : 'outline'} size="sm">
                {issues.length ? t('checklists.builder.issues', { count: issues.length }) : t('checklists.builder.noIssues')}
              </Button>
            </DropdownMenuTrigger>
            {issues.length > 0 && (
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {index.list.map((issue, i) => (
                  <DropdownMenuItem
                    key={i}
                    onSelect={() => {
                      setPreview(false);
                      if (issue.node) dispatch({ type: 'select', node: { kind: issue.node.kind, id: issue.node.id } });
                    }}
                  >
                    {t(issue.code)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
          {!props.readOnly && (
            <>
              <Button variant="ghost" size="icon" aria-label={t('checklists.builder.undo')} disabled={!state.past.length || readOnly} onClick={() => dispatch({ type: 'undo' })}>
                <Undo2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('checklists.builder.redo')} disabled={!state.future.length || readOnly} onClick={() => dispatch({ type: 'redo' })}>
                <Redo2 className="size-4" />
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setPreview((p) => !p)}>
            {preview ? t('checklists.builder.closePreview') : t('checklists.builder.previewToggle')}
          </Button>
          {props.actions}
          {props.onPublish && !props.readOnly && (
            <Button size="sm" disabled={issues.length > 0 || autosave.status === 'conflict'} onClick={() => setPublishing(true)}>
              {t('checklists.builder.publish')}
            </Button>
          )}
        </div>
      </div>

      {autosave.status === 'conflict' && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center gap-3">
            {t('checklists.builder.save.conflict')}
            <Button size="sm" variant="outline" onClick={() => window.confirm(t('checklists.builder.save.confirmReload')) && props.onReload?.()}>
              {t('checklists.builder.save.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preview ? (
        <PreviewPane content={state.content} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_22rem] gap-3">
          <Outline content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
          <Canvas content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
          <Inspector content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
        </div>
      )}

      {publishing && props.onPublish && (
        <PublishDialog
          onClose={() => setPublishing(false)}
          onSubmit={async (note) => {
            if (!(await autosave.flush())) return;
            await props.onPublish!(autosave.revision(), note);
            setPublishing(false);
          }}
        />
      )}
    </div>
  );
}

function PublishDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (note: string | null) => Promise<void> }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('checklists.builder.publishTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="change-note">{t('checklists.builder.changeNote')}</Label>
          <Textarea id="change-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(note.trim() || null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('checklists.builder.publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
