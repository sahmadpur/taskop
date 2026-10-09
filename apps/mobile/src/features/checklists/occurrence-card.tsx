import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { formatTime } from '@/lib/time';
import { colors, spacing } from '@/lib/theme';
import type { CardModel, GroupKey } from './group-occurrences';

type Tone = 'danger' | 'warning' | 'muted';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  danger: { bg: '#FEE2E2', fg: colors.danger },
  warning: { bg: '#FEF3C7', fg: '#92400E' },
  muted: { bg: '#EEF2FF', fg: colors.primary },
};

function Badge({ tone, text }: { tone: Tone; text: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: TONES[tone].bg }]}>
      <Text style={[styles.badgeText, { color: TONES[tone].fg }]}>{text}</Text>
    </View>
  );
}

interface Props {
  card: CardModel;
  group: GroupKey;
  timeZone: string;
  onStart: () => void;
  onOpen: () => void;
}

export function OccurrenceCard({ card, group, timeZone, onStart, onOpen }: Props) {
  const { t } = useTranslation();
  const o = card.occurrence;
  const e = o.execution;
  const status = e && e.state !== 'active' ? t(`executions.states.${e.state}`) : !e && o.status !== 'pending' ? t(`scheduling.statuses.${o.status}`) : null;
  return (
    <View testID={`occurrence-${o.id}`} style={[styles.card, card.overdue ? styles.overdue : null]}>
      <Text style={styles.title}>{o.checklistName}</Text>
      <Text style={styles.muted}>{o.shiftName ? `${o.siteName} · ${o.shiftName}` : o.siteName}</Text>
      <Text style={styles.muted}>{t('mobile.checklists.window', { from: formatTime(o.startsAt, timeZone), to: formatTime(o.closesAt, timeZone) })}</Text>
      <View style={styles.badges}>
        {card.overdue ? <Badge tone="danger" text={t('mobile.checklists.overdue')} /> : null}
        {card.late ? <Badge tone="warning" text={t('executions.flags.late')} /> : null}
        {card.claimedBy ? <Badge tone="muted" text={t('mobile.checklists.claimedBy', { name: card.claimedBy })} /> : null}
        {status && !card.claimedBy ? <Badge tone="muted" text={status} /> : null}
      </View>
      {group === 'upcoming' ? (
        <Text style={styles.muted}>{t('mobile.checklists.opensAt', { time: formatTime(o.startsAt, timeZone) })}</Text>
      ) : null}
      {card.action === 'start' ? (
        <PrimaryButton title={t('mobile.checklists.start')} accessibilityLabel={`${t('mobile.checklists.start')}: ${o.checklistName}`} onPress={onStart} />
      ) : null}
      {card.action === 'continue' ? (
        <PrimaryButton title={t('mobile.checklists.continue')} accessibilityLabel={`${t('mobile.checklists.continue')}: ${o.checklistName}`} onPress={onOpen} />
      ) : null}
      {card.action === 'view' ? (
        <PrimaryButton variant="outline" title={t('mobile.checklists.view')} accessibilityLabel={`${t('mobile.checklists.view')}: ${o.checklistName}`} onPress={onOpen} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  overdue: { borderColor: colors.danger, borderLeftWidth: 4 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  badge: { borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
