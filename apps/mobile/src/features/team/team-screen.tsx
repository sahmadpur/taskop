import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Choice } from '@/features/execution/parts';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useNow, useSyncStatus } from '@/offline/hooks';
import { CountTiles } from './count-tiles';
import { EmployeePicker } from './employee-picker';
import { useRefreshMeOnForbidden, useTeamEmployees, useTeamRuns, useTeamSummary } from './queries';
import { RunRow } from './run-row';
import { TeamOffline } from './team-offline';
import { CHIP_BUCKETS, type EmployeeChoice, employeeChoices, TEAM_CHIPS, TEAM_PERIODS, type TeamChip, type TeamPeriod, teamPeriod } from './team-rules';

/** Spec §7.1: the manager's Team tab. Online only and react-query only: nothing is written to the phone's database. */
export function TeamScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const now = useNow();
  const [preset, setPreset] = useState<TeamPeriod>('today');
  const [chip, setChip] = useState<TeamChip>('all');
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const me = s.status === 'authenticated' ? s.me : null;
  const viewerId = me?.user.id ?? '';
  const timeZone = me?.tenant.timezone ?? services.timeZone;
  // Decision 2: the tenant's day, recomputed on every tick, so "Bu gün" turns over at the tenant's midnight.
  const period = teamPeriod(preset, now, timeZone);
  const filters = { from: period.from, to: period.to, userId: employee?.userId ?? null };
  const live = online && me !== null;
  const summary = useTeamSummary(viewerId, filters, live);
  const employees = useTeamEmployees(viewerId, period.from, period.to, live);
  const runs = useTeamRuns(viewerId, filters, CHIP_BUCKETS[chip], live);
  useRefreshMeOnForbidden([summary.error, employees.error, runs.error]);

  if (!me) return null;
  if (!online) {
    // Decision 8: what was loaded is not shown offline; only the spec's message is.
    return (
      <SafeAreaView style={styles.safe}>
        <Text accessibilityRole="header" style={[styles.title, styles.pad]}>
          {t('mobile.team.title')}
        </Text>
        <TeamOffline />
      </SafeAreaView>
    );
  }

  const error = summary.error ?? employees.error ?? runs.error;
  // Decision 18: only what failed is asked again.
  const retry = () => {
    if (summary.isError) void summary.refetch();
    if (employees.isError) void employees.refetch();
    if (runs.isError) void runs.refetch();
  };
  const rows = runs.data?.pages.flatMap((p) => p.items) ?? [];
  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('mobile.team.title')}
      </Text>
      <View style={styles.chips}>
        {TEAM_PERIODS.map((p) => (
          <Choice key={p} role="radio" label={t(`mobile.team.periods.${p}`)} selected={preset === p} onPress={() => setPreset(p)} />
        ))}
      </View>
      {summary.data ? <CountTiles summary={summary.data} /> : summary.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.chips}>
        {TEAM_CHIPS.map((c) => (
          <Choice key={c} role="radio" label={t(`reports.buckets.${c}`)} selected={chip === c} onPress={() => setChip(c)} />
        ))}
      </View>
      <EmployeePicker choices={employees.data ? employeeChoices(employees.data) : []} selected={employee} onChange={setEmployee} />
      {error ? (
        <View style={styles.error}>
          <FormError message={mobileErrorText(t, error)} />
          <PrimaryButton variant="outline" title={t('common.retry')} onPress={retry} />
        </View>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        testID="team-runs"
        data={rows}
        keyExtractor={(r) => r.occurrenceId}
        renderItem={({ item }) => (
          <RunRow run={item} timeZone={timeZone} onPress={() => router.push({ pathname: '/team/run/[id]', params: { id: item.occurrenceId } })} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={runs.isPending ? <ActivityIndicator color={colors.primary} /> : runs.isError ? null : <Text style={styles.muted}>{t('reports.empty')}</Text>}
        ListFooterComponent={runs.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { gap: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm },
  muted: { color: colors.muted },
});
