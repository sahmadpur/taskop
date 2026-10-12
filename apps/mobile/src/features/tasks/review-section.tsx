import type { TaskSummary } from '@taskop/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';

/** Spec §7.2 "Yoxlama": tasks awaiting the caller's review, fetched whenever the tab gains focus while online (decision 13). */
export function ReviewSection() {
  const { t } = useTranslation();
  const { online } = useSyncStatus();
  const [items, setItems] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!online) return undefined;
      let alive = true;
      setError(null);
      api.tasks.list({ awaitingMyReview: 'true' }).then(
        (page) => {
          if (alive) setItems(page.items);
        },
        (e: unknown) => {
          if (alive) setError(mobileErrorText(t, e));
        },
      );
      return () => {
        alive = false;
      };
    }, [online, t]),
  );
  return (
    <View style={styles.group}>
      <Text testID="section-review" style={styles.section}>
        {t('mobile.tasks.sections.review')}
      </Text>
      {!online ? (
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      ) : error ? (
        <FormError message={error} />
      ) : items === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : items.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.tasks.review.empty')}</Text>
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            testID={`review-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: '/review/[id]', params: { id: item.id } })}
            style={styles.card}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.muted}>{item.assignee?.fullName ?? item.team?.name ?? ''}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
});
