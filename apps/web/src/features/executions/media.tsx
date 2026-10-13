import type { ExecutionMediaDto } from '@taskop/contracts';
import { Play } from 'lucide-react';
import { createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFormatDateTime } from '@/lib/format';
import { EXECUTION_MEDIA_SOURCE, type MediaUrlSource, useMediaUrl } from './queries';

/**
 * What the thumbnails and the lightbox need. Execution and task media have all of it; a task's source-problem
 * media are known by id, kind and status only (`ProblemDto.media`), so the capture details are optional.
 */
export type ViewableMedia = Pick<ExecutionMediaDto, 'id' | 'kind' | 'status' | 'durationMs'> &
  Partial<Pick<ExecutionMediaDto, 'source' | 'capturedAt' | 'capturedBy'>>;

const MediaUrlSourceContext = createContext<MediaUrlSource>(EXECUTION_MEDIA_SOURCE);

/** Thumbnails and lightboxes below sign their media through `source` (execution media by default). */
export function MediaUrlSourceProvider({ source, children }: { source: MediaUrlSource; children: ReactNode }) {
  return <MediaUrlSourceContext.Provider value={source}>{children}</MediaUrlSourceContext.Provider>;
}

/**
 * A presigned URL for an uploaded medium. It lives 5 minutes, so when the element fails to load it (the URL
 * expired while the page stayed open) a new one is fetched once. A second failure in a row is reported.
 */
export function useViewableUrl(id: string) {
  const query = useMediaUrl(id, useContext(MediaUrlSourceContext));
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  return {
    url: failed ? null : (query.data?.url ?? null),
    failed: failed || query.isError,
    onError: () => {
      if (retried) {
        setFailed(true);
        return;
      }
      setRetried(true);
      void query.refetch();
    },
    /** Loaded: a later expiry may refresh again. */
    onLoad: () => setRetried(false),
  };
}

export function MediaThumb<M extends ViewableMedia>({ media, onOpen }: { media: M; onOpen: (m: M) => void }) {
  const { t } = useTranslation();
  const kind = t(`executions.mediaKinds.${media.kind}`);
  if (media.status === 'pending') {
    // Registered by the phone but not uploaded yet: there is nothing to sign (spec §6.7).
    return (
      <span
        role="img"
        aria-label={t('executions.media.pendingLabel', { kind })}
        className="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-md border border-dashed p-1 text-center text-xs"
      >
        {t('executions.media.pending')}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={t('executions.media.open', { kind })}
      onClick={() => onOpen(media)}
      className="hover:ring-ring size-20 overflow-hidden rounded-md border hover:ring-2"
    >
      {media.kind === 'photo' ? (
        <PhotoPreview id={media.id} />
      ) : (
        <span className="bg-muted flex size-full flex-col items-center justify-center gap-1 text-xs">
          <Play className="size-5" aria-hidden />
          {media.durationMs !== null && t('executions.media.duration', { seconds: Math.round(media.durationMs / 1000) })}
        </span>
      )}
    </button>
  );
}

function PhotoPreview({ id }: { id: string }) {
  const { t } = useTranslation();
  const v = useViewableUrl(id);
  if (v.failed) return <span className="text-destructive text-xs">{t('executions.media.failed')}</span>;
  return v.url ? <img key={v.url} src={v.url} alt="" loading="lazy" className="size-full object-cover" onError={v.onError} onLoad={v.onLoad} /> : null;
}

export function MediaStrip<M extends ViewableMedia>(props: { ids: string[]; media: ReadonlyMap<string, M>; onOpen: (m: M) => void }) {
  const items = props.ids.map((id) => props.media.get(id)).filter((m): m is M => m !== undefined);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((m) => (
        <MediaThumb key={m.id} media={m} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

export function MediaLightbox({ media, onClose }: { media: ViewableMedia; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const v = useViewableUrl(media.id);
  const video = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const kind = t(`executions.mediaKinds.${media.kind}`);
  const caption =
    media.capturedAt && media.capturedBy
      ? [t('executions.media.captured', { time: formatDateTime(media.capturedAt), name: media.capturedBy.fullName }), ...(media.source ? [t(`executions.mediaSources.${media.source}`)] : [])].join(' · ')
      : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{kind}</DialogTitle>
          <DialogDescription className={caption ? undefined : 'sr-only'}>{caption ?? kind}</DialogDescription>
        </DialogHeader>
        {v.failed ? (
          <p className="text-destructive">{t('executions.media.failed')}</p>
        ) : !v.url ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : media.kind === 'photo' ? (
          <img key={v.url} src={v.url} alt={kind} className="max-h-[75vh] w-full object-contain" onError={v.onError} onLoad={v.onLoad} />
        ) : (
          <video
            key={v.url}
            ref={video}
            src={v.url}
            controls
            aria-label={kind}
            className="max-h-[75vh] w-full"
            onError={() => {
              // A range request after the URL expired fails mid-play: continue from here with a new URL.
              resumeAt.current = video.current?.currentTime ?? 0;
              v.onError();
            }}
            onLoadedMetadata={() => {
              if (video.current && resumeAt.current > 0) video.current.currentTime = resumeAt.current;
            }}
            onLoadedData={v.onLoad}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
