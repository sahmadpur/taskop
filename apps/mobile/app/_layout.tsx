import '@/lib/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadLanguage, setLanguage } from '@/lib/language';
import i18n from '@/lib/i18n';
import { session, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { configureNotifications } from '@/notifications/native';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

// Spec §7.1: the foreground handler and Android's channel exist before any notification can arrive.
configureNotifications(
  () => {
    const s = session.get();
    return s.status === 'authenticated' ? s.me.user.id : null;
  },
  session.subscribe,
);

export default function RootLayout() {
  const s = useSession();
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => {
    void session.bootstrap();
    // The stored choice (or the device language) applies before the first screen, so nothing flashes in Azerbaijani.
    void loadLanguage()
      .then((lng) => i18n.changeLanguage(lng))
      .finally(() => setLanguageReady(true));
  }, []);

  // A language saved on the profile wins over the phone's choice, so every device of the user agrees.
  const profileLanguage = s.status === 'authenticated' ? s.me.user.locale : null;
  useEffect(() => {
    if (profileLanguage) void setLanguage(profileLanguage);
  }, [profileLanguage]);

  if (s.status === 'loading' || !languageReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={s.status === 'authenticated'}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={s.status === 'anonymous'}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
