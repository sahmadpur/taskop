import type { ProblemMediaRef, TaskMediaDto } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { MediaLightbox, MediaThumb, MediaUrlSourceProvider, type ViewableMedia } from '@/features/executions/media';
import type { MediaUrlSource } from '@/features/executions/queries';
import { api } from '@/lib/session';

/** GET /task-media/:id/url: instruction and response media, for anyone who can read the task. */
export const TASK_MEDIA_SOURCE: MediaUrlSource = { key: (id) => ['task-media', 'url', id], fetch: (id) => api.taskMedia.url(id) };

/** GET /tasks/:id/problem-media/:mediaId/url (Part 1 decision 14): the source problem's media, for task readers. */
export const problemMediaSource = (taskId: string): MediaUrlSource => ({
  key: (id) => ['tasks', 'problem-media', taskId, id],
  fetch: (id) => api.tasks.problemMediaUrl(taskId, id),
});

/** Thumbnails of a task's own media; pending ones are shown as not uploaded and never signed. */
export function TaskMediaStrip({ media }: { media: TaskMediaDto[] }) {
  const [open, setOpen] = useState<TaskMediaDto | null>(null);
  if (!media.length) return null;
  return (
    <MediaUrlSourceProvider source={TASK_MEDIA_SOURCE}>
      <div className="flex flex-wrap gap-2">
        {media.map((m) => (
          <MediaThumb key={m.id} media={m} onOpen={setOpen} />
        ))}
      </div>
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </MediaUrlSourceProvider>
  );
}

/**
 * The source problem's media (`ProblemDto.media`: kind and status, Part 1 decision 24), through the shared thumbnail:
 * pending ones (not uploaded yet, or purged) are drawn as such and never signed. The duration is not known here.
 */
export function ProblemMediaStrip({ taskId, media }: { taskId: string; media: ProblemMediaRef[] }) {
  const source = useMemo(() => problemMediaSource(taskId), [taskId]);
  const [open, setOpen] = useState<ViewableMedia | null>(null);
  if (!media.length) return null;
  return (
    <MediaUrlSourceProvider source={source}>
      <div className="flex flex-wrap gap-2">
        {media.map((m) => (
          <MediaThumb key={m.id} media={{ ...m, durationMs: null }} onOpen={setOpen} />
        ))}
      </div>
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </MediaUrlSourceProvider>
  );
}
