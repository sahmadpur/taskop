import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

/** Spec §8: the badge polls every 30 s and on window focus. */
export const UNREAD_REFETCH_MS = 30_000;
/** The bell's popover lists the 10 latest. */
export const BELL_LIMIT = 10;
/** /notifications pages (spec §6.4: 30 per page). */
export const INBOX_PAGE_SIZE = 30;
/** Manual message history pages (cursorQuerySchema's default). */
export const MESSAGES_PAGE_SIZE = 50;
/** While a sent message is still fanning out (`processed: false`), its history row and detail are asked again this often. */
export const MESSAGE_PROCESSING_REFETCH_MS = 3_000;

export const notificationKeys = {
  /** Every inbox query: invalidated after any read-state change. */
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  latest: ['notifications', 'latest'] as const,
  inbox: (unreadOnly: boolean) => ['notifications', 'inbox', unreadOnly] as const,
  rules: ['notification-rules'] as const,
  messages: ['notification-messages'] as const,
  messageList: ['notification-messages', 'list'] as const,
  message: (id: string) => ['notification-messages', 'detail', id] as const,
  targetOptions: (q: string) => ['notification-messages', 'options', q] as const,
};

/**
 * The unread badge. The app's defaults (30 s stale, no focus refetch) are overridden here: the count is always stale,
 * so it is asked again every 30 s and whenever the window gets focus.
 */
export const useUnreadCount = () =>
  useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => api.notifications.unreadCount(),
    refetchInterval: UNREAD_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

/** The bell's popover: asked only while it is open. */
export const useLatestNotifications = (enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.latest,
    queryFn: async () => (await api.notifications.list({ limit: BELL_LIMIT })).items,
    enabled,
    staleTime: 0,
  });

export const useInbox = (unreadOnly: boolean) =>
  useInfiniteQuery({
    queryKey: notificationKeys.inbox(unreadOnly),
    queryFn: ({ pageParam }) =>
      api.notifications.list({ cursor: pageParam, limit: INBOX_PAGE_SIZE, ...(unreadOnly ? { unread: 'true' as const } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Marks every notification read; a failure is told in a toast, and the lists are asked again either way. */
export function useMarkAllRead() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onError: (e) => toast.error(errorText(t, e)),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export const useNotificationRules = () => useQuery({ queryKey: notificationKeys.rules, queryFn: () => api.notificationRules.list() });

/** The message picker's options for `q` (people and teams are searched by the API; sites come whole). */
export const useMessageTargetOptions = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.targetOptions(q),
    queryFn: () => api.messages.options(q ? { q } : {}),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

/** The history; polled while any loaded message is still fanning out, so a fresh send's counts appear without a reload. */
export const useMessages = () =>
  useInfiniteQuery({
    queryKey: notificationKeys.messageList,
    queryFn: ({ pageParam }) => api.messages.list({ cursor: pageParam, limit: MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some((m) => !m.processed)) ? MESSAGE_PROCESSING_REFETCH_MS : false),
  });

/** One message's detail, polled until it is processed; a blank id (e.g. an empty `?message=`) asks for nothing. */
export const useMessage = (id: string) =>
  useQuery({
    queryKey: notificationKeys.message(id),
    queryFn: () => api.messages.get(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && !q.state.data.processed ? MESSAGE_PROCESSING_REFETCH_MS : false),
  });
