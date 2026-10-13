import type { NotificationItem } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/features/tasks/screen-header';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { createRouteContext, INBOX, routeForTarget } from '@/notifications/notification-router';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';

/** Spec §6.4: GET /me/notifications returns 30 per page. */
export const INBOX_PAGE_SIZE = 30;

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Spec §7.4: the inbox, online only (it is not part of the offline store). */
export function InboxScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const session = useSession();
  const { online } = useSyncStatus();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** Bumped by every reload: a page requested before it is dropped when it arrives. */
  const generation = useRef(0);
  const moreInFlight = useRef(false);
  const opening = useRef(false);
  const canManageTasks = useRef(false);
  canManageTasks.current = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  const nowIso = () => new Date(services.clock.now()).toISOString();

  /** Decision 14: the bell and the badge follow the server's count at once, not at the next sync. */
  const refreshUnread = useCallback(async () => {
    try {
      await services.setUnreadNotifications((await api.notifications.unreadCount()).count);
    } catch (e) {
      console.warn('[notifications] Could not refresh the unread count', message(e));
    }
  }, [services]);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    setError(null);
    try {
      const page = await api.notifications.list({ limit: INBOX_PAGE_SIZE });
      if (gen !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      if (gen === generation.current) setError(mobileErrorText(t, e));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      if (online) void Promise.all([reload(), refreshUnread()]);
    }, [online, reload, refreshUnread]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), refreshUnread()]);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!online || cursor === null || moreInFlight.current) return;
    const gen = generation.current;
    moreInFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await api.notifications.list({ cursor, limit: INBOX_PAGE_SIZE });
      if (gen !== generation.current) return;
      setItems((current) => {
        const have = new Set((current ?? []).map((i) => i.id));
        return [...(current ?? []), ...page.items.filter((i) => !have.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      if (gen === generation.current) setError(mobileErrorText(t, e));
    } finally {
      if (gen === generation.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    setError(null);
    try {
      await api.notifications.markAllRead();
      const at = nowIso();
      setItems((current) => current?.map((i) => (i.readAt ? i : { ...i, readAt: at })) ?? current);
      await refreshUnread();
    } catch (e) {
      setError(mobileErrorText(t, e));
    } finally {
      setMarkingAll(false);
    }
  };

  /** Spec §7.4: a tap marks the row read and opens its target as a push would (§7.3). */
  const open = async (item: NotificationItem) => {
    if (opening.current) return;
    opening.current = true;
    setOpeningId(item.id);
    try {
      if (item.readAt === null) {
        const at = nowIso();
        setItems((current) => current?.map((i) => (i.id === item.id ? { ...i, readAt: at } : i)) ?? current);
        api.notifications.markRead(item.id).then(
          () => refreshUnread(),
          (e: unknown) => console.warn('[notifications] Could not mark a notification read', message(e)),
        );
      }
      const route = await routeForTarget(item, createRouteContext(services, () => canManageTasks.current));
      if (route.pathname !== INBOX.pathname) router.push(route);
    } catch (e) {
      console.error('[notifications] Could not open a notification', message(e));
    } finally {
      opening.current = false;
      setOpeningId(null);
    }
  };

  const hasUnread = items?.some((i) => i.readAt === null) ?? false;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <ScreenHeader title={t('notifications.title')} />
        {online && items && items.length > 0 ? (
          <PrimaryButton variant="outline" title={t('notifications.markAllRead')} onPress={() => void markAll()} disabled={markingAll || !hasUnread} />
        ) : null}
      </View>
      {!online ? (
        <Text style={[styles.muted, styles.pad]}>{t('mobile.notifications.online')}</Text>
      ) : items === null ? (
        <View style={styles.pad}>
          {error ? (
            <>
              <FormError message={error} />
              <PrimaryButton title={t('common.retry')} onPress={() => void reload()} />
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <FlatList
          testID="notification-list"
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <InboxRow item={item} timeZone={services.timeZone} opening={openingId === item.id} onPress={() => void open(item)} />}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<Text style={styles.muted}>{t('notifications.empty')}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : <FormError message={error} />}
        />
      )}
    </SafeAreaView>
  );
}

function InboxRow({ item, timeZone, opening, onPress }: { item: NotificationItem; timeZone: string; opening: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const unread = item.readAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t('mobile.notifications.unread')}: ${item.title}` : item.title}
      testID={`notification-${item.id}`}
      onPress={onPress}
      style={[styles.row, unread && styles.unreadRow]}
    >
      <View style={styles.rowTop}>
        {unread ? <View style={styles.dot} /> : null}
        <Text style={[styles.title, unread && styles.bold]}>{item.title}</Text>
        {opening ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <Text style={styles.body}>{item.body}</Text>
      <Text style={styles.muted}>{formatDateTime(item.createdAt, { locale: 'az', timeZone })}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  unreadRow: { borderColor: colors.primary },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  title: { fontSize: 16, fontWeight: '500', color: colors.text, flexShrink: 1 },
  bold: { fontWeight: '700' },
  body: { color: colors.text },
  muted: { color: colors.muted },
});
