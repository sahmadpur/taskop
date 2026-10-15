import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { canSeeTeam } from '@/features/team/team-rules';
import { useSession } from '@/lib/session';
import { colors, font } from '@/lib/theme';
import { NotificationsBridge } from '@/notifications/notifications-bridge';
import { OfflineProvider } from '@/offline/offline-provider';

/** Screens reached from inside the app, not from the tab bar. */
const HIDDEN = { href: null, tabBarStyle: { display: 'none' } } as const;

export default function AppLayout() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  // SP7 spec §7.1: only for reports.view with a scope wider than own. The routes check it again (TeamGate).
  const team = canSeeTeam(s.me);
  return (
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <NotificationsBridge />
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 },
          tabBarLabelStyle: { fontFamily: font, fontSize: 12, fontWeight: '600' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={size} /> }} />
        <Tabs.Screen name="tasks" options={{ title: t('mobile.tabs.tasks'), tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} color={color} size={size} /> }} />
        <Tabs.Screen
          name="team/index"
          options={{
            title: t('mobile.tabs.team'),
            tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size} />,
            ...(team ? {} : { href: null }),
          }}
        />
        <Tabs.Screen name="profile" options={{ title: t('mobile.tabs.profile'), tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'person' : 'person-outline'} color={color} size={size} /> }} />
        <Tabs.Screen name="change-secret" options={{ href: null }} />
        <Tabs.Screen name="sync" options={HIDDEN} />
        <Tabs.Screen name="execution/[id]/index" options={HIDDEN} />
        <Tabs.Screen name="execution/[id]/finish" options={HIDDEN} />
        <Tabs.Screen name="task/[id]" options={HIDDEN} />
        <Tabs.Screen name="task/new" options={HIDDEN} />
        <Tabs.Screen name="review/[id]" options={HIDDEN} />
        <Tabs.Screen name="notifications" options={HIDDEN} />
        <Tabs.Screen name="team/run/[id]" options={HIDDEN} />
      </Tabs>
    </OfflineProvider>
  );
}
