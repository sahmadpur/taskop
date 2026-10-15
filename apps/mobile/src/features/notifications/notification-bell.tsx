import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { useUnreadNotifications } from '@/offline/hooks';

/** Spec §7.4: the Home header bell with the unread count of the last sync, opening the inbox. */
export function NotificationBell({ tone = 'dark' }: { tone?: 'dark' | 'light' } = {}) {
  const { t } = useTranslation();
  const count = useUnreadNotifications();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.notifications.bell', { count })}
      testID="notification-bell"
      onPress={() => router.push('/notifications')}
      style={styles.bell}
    >
      <Ionicons name="notifications-outline" size={26} color={tone === 'light' ? colors.onDeep : colors.text} />
      {count > 0 ? (
        <View testID="notification-bell-count" style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.primaryText, fontSize: 11, fontWeight: '700' },
});
