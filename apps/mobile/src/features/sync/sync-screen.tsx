import { formatDateTime } from '@taskop/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { colors, spacing } from '@/lib/theme';
import { isClockSkewed } from '@/offline/clock';
import { useOffline } from '@/offline/context';
import { useLiveQuery, useSyncStatus } from '@/offline/hooks';
import { mediaErrorKey } from '@/offline/media-queue';
import { listCommands } from '@/offline/outbox';

interface Row {
  key: string;
  title: string;
  error: string | null;
}

/** FR-10.15: what is waiting, what failed and why, and "Yenidən cəhd et". */
export function SyncScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const queue = useLiveQuery(async (s) => ({ commands: await listCommands(s.db), media: await s.mediaQueue.list() }), []);
  const name = (n: string | null) => n ?? '—';
  const rows: Row[] = [
    ...(queue?.commands ?? []).map((c) => ({
      key: `c${c.seq}`,
      title: `${t(`mobile.sync.kinds.${c.kind}`)} · ${name(c.checklistName)}`,
      error: c.status === 'failed' ? t(c.errorKey ?? 'errors.INTERNAL', { requestId: '—' }) : null,
    })),
    ...(queue?.media ?? []).map((m) => ({
      key: `m${m.id}`,
      title: `${t('mobile.sync.kinds.upload')} · ${name(m.checklistName)}`,
      error: m.failedCode ? t(mediaErrorKey(m.failedCode)) : null,
    })),
  ];

  const retry = async () => {
    setBusy(true);
    try {
      await services.engine.retryFailed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('mobile.sync.title')}</Text>
      </View>
      <Text style={styles.muted}>
        {status.lastSyncedAt
          ? t('mobile.sync.lastSynced', { time: formatDateTime(status.lastSyncedAt, { locale: 'az', timeZone: services.timeZone }) })
          : t('mobile.sync.never')}
      </Text>
      {isClockSkewed(status.clockOffsetMs) ? (
        <Text style={styles.warning}>{t('mobile.sync.clockSkew', { minutes: Math.round(Math.abs(status.clockOffsetMs) / 60_000) })}</Text>
      ) : null}
      {status.blockedByAuth ? <Text style={styles.warning}>{t('mobile.sync.signInAgain')}</Text> : null}
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.sync.empty')}</Text>
      ) : (
        rows.map((row) => (
          <View key={row.key} style={[styles.row, row.error ? styles.rowFailed : null]}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            {row.error ? <Text style={styles.error}>{row.error}</Text> : <Text style={styles.muted}>{t('mobile.sync.states.pending')}</Text>}
          </View>
        ))
      )}
      <PrimaryButton title={t('mobile.sync.retry')} onPress={() => void retry()} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  warning: { color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  row: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  rowFailed: { borderColor: colors.danger },
  rowTitle: { color: colors.text, fontWeight: '500' },
  error: { color: colors.danger },
});
