import {
  type Answer,
  type Answers,
  type ChecklistContent,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type Item,
  type MediaKind,
  type MediaUrl,
  visibleItems,
  walkItems,
} from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { type RemoteMedia, RemoteMediaStrip } from '@/features/tasks/remote-media';
import { Badge } from '@/features/tasks/task-row';
import { colors, spacing } from '@/lib/theme';
import { fromAnswerDatetime } from './datetime-format';
import { choiceOptions, Options } from './parts';

type LoadUrl = (mediaId: string) => Promise<MediaUrl>;

/** Server media by id (decision 13): an id the server has not registered yet is drawn as not uploaded. */
export function remoteMedia(ids: readonly string[], media: readonly ExecutionMediaDto[], kind: MediaKind): RemoteMedia[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => {
    const m = byId.get(id);
    return m ? { id, kind: m.kind, status: m.status } : { id, kind, status: 'pending' };
  });
}

/**
 * A non-choice answer as text, as the worker's field shows it (decision 12): a number with its unit, the text, the date
 * through `fromAnswerDatetime`. Null when unanswered. Photo and video items have none: their media are the answer.
 */
export function answerText(item: Item, a: Answer | undefined): string | null {
  if (!a) return null;
  switch (item.type) {
    case 'number':
      return typeof a.number === 'number' ? (item.unit ? `${a.number} ${item.unit}` : String(a.number)) : null;
    case 'text':
    case 'comment':
      return a.text?.trim() ? a.text : null;
    case 'datetime':
      return a.datetime ? fromAnswerDatetime(item.mode, a.datetime) : null;
    default:
      return null;
  }
}

/** SP7 spec §7.2: an execution's answers, read-only, in the pinned version's layout. Hidden follow-ups are left out. */
export function ReadOnlyAnswers(p: { content: ChecklistContent; answers: Answers; media: readonly ExecutionMediaDto[]; problems: readonly ExecutionProblem[]; load: LoadUrl }) {
  const { t } = useTranslation();
  if (Object.keys(p.answers).length === 0) return <Text style={styles.muted}>{t('executions.noAnswers')}</Text>;
  const visible = visibleItems(p.content, p.answers);
  const flagged = new Set(p.problems.map((x) => x.itemId));
  return (
    <View style={styles.list}>
      {p.content.sections.map((section) => {
        const rows = visible.filter((v) => v.sectionId === section.id);
        if (rows.length === 0) return null;
        return (
          <View key={section.id} style={styles.list}>
            <Text style={styles.section}>{section.title}</Text>
            {rows.map(({ item, depth }) => (
              <View key={item.id} style={{ marginLeft: depth * spacing.md }}>
                <ReadOnlyItem item={item} answer={p.answers[item.id]} media={p.media} flagged={flagged.has(item.id)} load={p.load} />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** One item's answer, read-only (SP7); the audit (SP8) draws each item with it. */
export function ReadOnlyItem({ item, answer, media, flagged, load }: { item: Item; answer: Answer | undefined; media: readonly ExecutionMediaDto[]; flagged: boolean; load: LoadUrl }) {
  const { t } = useTranslation();
  const options = choiceOptions(item, t);
  const text = answerText(item, answer);
  const evidence = [...remoteMedia(answer?.photos ?? [], media, 'photo'), ...remoteMedia(answer?.videos ?? [], media, 'video')];
  const answered = (options !== null && (answer?.optionIds?.length ?? 0) > 0) || text !== null || evidence.length > 0;
  const note = answer?.note?.trim();
  return (
    <View testID={`answer-${item.id}`} style={styles.card}>
      <Text style={styles.label}>{item.label}</Text>
      {options ? <Options options={options} selected={answer?.optionIds ?? []} multi={item.type === 'multi_choice'} disabled onChange={() => undefined} /> : null}
      {text !== null ? <Text style={styles.value}>{text}</Text> : null}
      {!answered ? <Text style={styles.muted}>{t('executions.notAnswered')}</Text> : null}
      <RemoteMediaStrip items={evidence} load={load} />
      {note ? <Text style={styles.muted}>{t('executions.note', { note })}</Text> : null}
      {flagged ? <Text style={styles.problem}>{t('mobile.execution.problemFlagged')}</Text> : null}
    </View>
  );
}

/** SP7 spec §7.2: the problems after the answers, each with its item, severity, source, resolution, note and media. */
export function ReadOnlyProblems(p: { content: ChecklistContent; problems: readonly ExecutionProblem[]; media: readonly ExecutionMediaDto[]; load: LoadUrl }) {
  const { t } = useTranslation();
  if (p.problems.length === 0) return null;
  const labels = new Map<string, string>();
  walkItems(p.content, (item) => labels.set(item.id, item.label));
  return (
    <View style={styles.list}>
      <Text style={styles.section}>{t('reports.tabs.problems')}</Text>
      {p.problems.map((x) => (
        <View key={x.id} testID={`problem-${x.id}`} style={[styles.card, x.severity === 'critical' ? styles.critical : null]}>
          <Text style={styles.label}>{labels.get(x.itemId) ?? t('executions.problemsPage.unknownItem')}</Text>
          <View style={styles.badges}>
            <Badge text={t(`executions.severities.${x.severity}`)} tone={x.severity === 'critical' ? 'danger' : 'warning'} />
            <Badge text={t(`executions.problemSources.${x.source}`)} />
            <Badge text={t(`tasks.resolutions.${x.resolution}`)} tone={x.resolution === 'resolved' ? 'success' : 'neutral'} />
          </View>
          {x.note ? <Text style={styles.value}>{x.note}</Text> : null}
          <RemoteMediaStrip items={remoteMedia(x.mediaIds, p.media, 'photo')} load={p.load} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  critical: { borderColor: colors.danger },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { fontSize: 16, color: colors.text },
  muted: { color: colors.muted },
  problem: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
