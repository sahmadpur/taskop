import { ApiError } from '@taskop/api-client';
import type { ChecklistContent, ContentSaveResult } from '@taskop/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface Options {
  content: ChecklistContent;
  version: number;
  initialRevision: number;
  /** Absent in read-only mode: nothing is ever saved. */
  save?: (content: ChecklistContent, revision: number) => Promise<ContentSaveResult>;
  delayMs?: number;
}

const CONFLICTS = new Set(['CHECKLIST_DRAFT_CONFLICT', 'TEMPLATE_CONFLICT']);

/**
 * Debounced autosave with one request in flight. Each save sends the last known revision;
 * a conflict stops autosave until the page reloads the draft.
 */
export function useAutosave({ content, version, initialRevision, save, delayMs = 1500 }: Options) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const latest = useRef({ content, version });
  const saveRef = useRef(save);
  const savedVersion = useRef(version);
  const revision = useRef(initialRevision);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    latest.current = { content, version };
    saveRef.current = save;
  });

  const runOnce = useCallback(async function run(): Promise<boolean> {
    const snap = latest.current;
    if (snap.version === savedVersion.current) {
      setStatus('saved');
      return true;
    }
    setStatus('saving');
    try {
      const res = await saveRef.current!(snap.content, revision.current);
      revision.current = res.revision;
      savedVersion.current = snap.version;
      // Edits made while this request was in flight are saved right away.
      return run();
    } catch (e) {
      const conflict = e instanceof ApiError && CONFLICTS.has(e.code);
      blocked.current = conflict;
      setStatus(conflict ? 'conflict' : 'error');
      return false;
    }
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (blocked.current) return Promise.resolve(false);
    if (!saveRef.current) return Promise.resolve(latest.current.version === savedVersion.current);
    inFlight.current ??= runOnce().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [runOnce]);

  // Depend on whether saving is possible, not on `save` itself: callers pass inline lambdas,
  // and a new identity every render must not restart the debounce.
  const canSave = Boolean(save);
  useEffect(() => {
    if (!canSave || blocked.current || version === savedVersion.current) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [version, canSave, delayMs, flush]);

  // Closing the tab while edits are unsaved or still saving asks the browser to confirm.
  const unsaved = canSave && (status === 'dirty' || status === 'saving');
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      // Leaving the builder (e.g. navigating away) still saves pending edits.
      if (latest.current.version !== savedVersion.current) void flush();
    };
  }, [flush]);

  return { status, flush, revision: () => revision.current };
}
