import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import { teamKeys, useRefreshMeOnForbidden, useTeamEmployees, useTeamRuns, useTeamSummary } from './queries';
import { RunRow } from './run-row';
import { TeamOffline } from './team-offline';
import {
  CHIP_BUCKETS,
  type EmployeeChoice,
  employeeChoices,
  TEAM_CHIPS,
  TEAM_PERIODS,
  type TeamChip,
  type TeamPeriod,
  teamPeriod,
  uniqueRuns,
} from './team-rules';

/** Spec §7.1: the manager's Team tab. Online only and react-query only: nothing is written to the phone's database. */
export function TeamScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const now = useNow();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<TeamPeriod>('today');
  const [chip, setChip] = useState<TeamChip>('all');
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  // Decision 7: Tabs keep this screen mounted; coming back to it reloads what has gone stale (not on the first focus).
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      if (live) void queryClient.refetchQueries({ queryKey: teamKeys.list(viewerId), type: 'active', stale: true });
    }, [live, queryClient, viewerId]),
  );

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
  // Decision 18: only what failed is asked again; a failed next page keeps the rows and asks for that same page.
  const retry = () => {
    if (summary.isError) void summary.refetch();
    if (employees.isError) void employees.refetch();
    if (runs.isError) void (runs.isFetchNextPageError ? runs.fetchNextPage({ cancelRefetch: false }) : runs.refetch());
  };
  // Decision 16: refetch() cancels a next page still loading, so a stale page is never appended to the fresh first one.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([summary.refetch(), employees.refetch(), runs.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  // Decision 16: one page at a time, never during a refresh, and never again by itself after a failed page.
  const loadMore = () => {
    if (runs.hasNextPage && !runs.isFetching && !runs.isFetchNextPageError) void runs.fetchNextPage({ cancelRefetch: false });
  };
  const rows = runs.data ? uniqueRuns(runs.data.pages) : [];
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
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
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
