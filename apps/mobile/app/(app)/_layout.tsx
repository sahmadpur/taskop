import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { OfflineProvider } from '@/offline/offline-provider';

export default function AppLayout() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  return (
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
        <Tabs.Screen name="index" options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="profile" options={{ title: t('mobile.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="change-secret" options={{ href: null }} />
      </Tabs>
    </OfflineProvider>
  );
}
