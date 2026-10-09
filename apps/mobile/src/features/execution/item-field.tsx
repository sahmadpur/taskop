import {
  type Answer,
  type DateTimeItem,
  EXECUTION_LIMITS,
  hasRules,
  type Item,
  MEDIA_KINDS,
  type MediaKind,
  mediaLimitFor,
  type MediaSource,
  type Missing,
  type NumberItem,
  ruleMatches,
} from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommitInput } from '@/components/commit-input';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import type { LocalMedia } from '@/offline/local-model';
import { fromAnswerDatetime, nowInputFor, toAnswerDatetime } from './datetime-format';
import { Chip, Choice, EvidenceRow } from './parts';

export interface ItemFieldProps {
  item: Item;
  answer: Answer | undefined;
  missing: Missing[];
  /** A rule or manual problem is recorded for this item. */
  hasProblem: boolean;
  readOnly: boolean;
  media: ReadonlyMap<string, LocalMedia>;
  onPatch: (patch: Partial<Answer>) => void;
  onCapture: (kind: MediaKind, source: MediaSource) => void;
  onRemoveMedia: (mediaId: string) => void;
  onOpenVideo: (uri: string) => void;
  onFlag: () => void;
}

function Options(p: { options: readonly { id: string; label: string }[]; selected: string[]; multi: boolean; disabled: boolean; onChange: (ids: string[]) => void }) {
  return (
    <View style={styles.options}>
      {p.options.map((o) => {
        const on = p.selected.includes(o.id);
        return (
          <Choice
            key={o.id}
            label={o.label}
            selected={on}
            role={p.multi ? 'checkbox' : 'radio'}
            disabled={p.disabled}
            onPress={() => p.onChange(p.multi ? (on ? p.selected.filter((x) => x !== o.id) : [...p.selected, o.id]) : [o.id])}
          />
        );
      })}
    </View>
  );
}

function NumberInput(p: { item: NumberItem; value: number | undefined; disabled: boolean; onChange: (n: number | undefined) => void }) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const { item } = p;
  const commit = (text: string) => {
    const s = text.trim().replace(',', '.');
    if (!s) {
      setInvalid(false);
      p.onChange(undefined);
      return;
    }
    const n = Number(s);
    const ok = Number.isFinite(n) && (item.min === null || n >= item.min) && (item.max === null || n <= item.max);
    setInvalid(!ok);
    if (ok) p.onChange(Math.round(n * 10 ** item.decimals) / 10 ** item.decimals);
  };
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <CommitInput accessibilityLabel={item.label} keyboardType="decimal-pad" value={p.value === undefined ? '' : String(p.value)} editable={!p.disabled} onCommit={commit} style={styles.flex} />
        {item.unit ? <Text style={styles.unit}>{item.unit}</Text> : null}
      </View>
      {item.min !== null && item.max !== null ? <Text style={styles.help}>{t('mobile.execution.numberRange', { min: item.min, max: item.max })}</Text> : null}
      {invalid ? <Text style={styles.missing}>{t('mobile.execution.invalidNumber')}</Text> : null}
    </View>
  );
}

function DateTimeInput(p: { item: DateTimeItem; value: string | undefined; disabled: boolean; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation();
  const { clock } = useOffline();
  const [invalid, setInvalid] = useState(false);
  const commit = (text: string) => {
    if (!text.trim()) {
      setInvalid(false);
      p.onChange(undefined);
      return;
    }
    const v = toAnswerDatetime(p.item.mode, text);
    setInvalid(v === null);
    if (v !== null) p.onChange(v);
  };
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <CommitInput
          accessibilityLabel={p.item.label}
          placeholder={t(`mobile.execution.datePlaceholder.${p.item.mode}`)}
          value={fromAnswerDatetime(p.item.mode, p.value)}
          editable={!p.disabled}
          onCommit={commit}
          style={styles.flex}
        />
        <Chip label={t('mobile.execution.now')} disabled={p.disabled} onPress={() => commit(nowInputFor(p.item.mode, clock.now()))} />
      </View>
      {invalid ? <Text style={styles.missing}>{t('mobile.execution.invalidDate')}</Text> : null}
    </View>
  );
}

function AnswerInput(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny': {
      const options = (item.options as readonly { id: string; key: string }[]).map((o) => ({ id: o.id, label: t(`checklists.builder.fixedOptions.${o.key}`) }));
      return <Options options={options} selected={answer?.optionIds ?? []} multi={false} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
    }
    case 'single_choice':
    case 'multi_choice':
      return <Options options={item.options} selected={answer?.optionIds ?? []} multi={item.type === 'multi_choice'} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
    case 'number':
      return <NumberInput item={item} value={answer?.number} disabled={p.readOnly} onChange={(number) => p.onPatch({ number })} />;
    case 'text':
    case 'comment':
      return (
        <CommitInput
          accessibilityLabel={item.label}
          value={answer?.text ?? ''}
          editable={!p.readOnly}
          multiline={item.type === 'comment'}
          maxLength={item.maxLength}
          onCommit={(text) => p.onPatch({ text: text.trim() ? text : undefined })}
        />
      );
    case 'datetime':
      return <DateTimeInput item={item} value={answer?.datetime} disabled={p.readOnly} onChange={(datetime) => p.onPatch({ datetime })} />;
    case 'photo':
    case 'video':
      return null; // their media are the answer, shown by the evidence row below
  }
}

/** One item: its input, evidence, the note its rule asks for, what is still missing, and the ⚑ problem flag. */
export function ItemField(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  const needsNote = (hasRules(item) && item.rules.some((r) => r.then.requireNote && ruleMatches(r, item, answer))) || Boolean(answer?.note);
  // A photo/video item's own media, or the evidence its settings and rules allow: one row per allowed kind.
  const evidenceKinds = MEDIA_KINDS.filter((k) => mediaLimitFor(item, k) > 0);
  return (
    <View testID={`item-${item.id}`} style={[styles.card, p.missing.length > 0 ? styles.cardMissing : null]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{item.label}</Text>
        {item.required ? <Text style={styles.required}>*</Text> : null}
      </View>
      {item.helpText ? <Text style={styles.help}>{item.helpText}</Text> : null}
      <AnswerInput {...p} />
      {evidenceKinds.map((kind) => (
        <EvidenceRow
          key={kind}
          kind={kind}
          ids={(kind === 'photo' ? answer?.photos : answer?.videos) ?? []}
          limit={mediaLimitFor(item, kind)}
          liveOnly={item.evidence.liveOnly}
          readOnly={p.readOnly}
          media={p.media}
          onCapture={p.onCapture}
          onRemove={p.onRemoveMedia}
          onOpenVideo={p.onOpenVideo}
        />
      ))}
      {needsNote ? (
        <CommitInput
          accessibilityLabel={`${t('mobile.execution.note')}: ${item.label}`}
          placeholder={t('mobile.execution.notePlaceholder')}
          value={answer?.note ?? ''}
          editable={!p.readOnly}
          multiline
          maxLength={EXECUTION_LIMITS.answerNote}
          onCommit={(note) => p.onPatch({ note: note.trim() ? note : undefined })}
        />
      ) : null}
      {p.missing
        .filter((m) => m.kind !== 'answer')
        .map((m) => (
          <Text key={m.kind} style={styles.missing}>
            {t(`mobile.finish.missingKinds.${m.kind}`)}
          </Text>
        ))}
      <View style={styles.footer}>
        {p.hasProblem ? <Text style={styles.problem}>{t('mobile.execution.problemFlagged')}</Text> : <View />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('mobile.execution.flagProblem')}: ${item.label}`}
          accessibilityState={{ disabled: p.readOnly }}
          disabled={p.readOnly}
          onPress={p.onFlag}
          style={styles.flag}
        >
          <Text style={[styles.flagText, answer?.problem ? styles.flagActive : null]}>⚑ {t('mobile.execution.flagProblem')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  cardMissing: { borderColor: colors.warning },
  labelRow: { flexDirection: 'row', gap: spacing.xs },
  label: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1 },
  required: { color: colors.danger, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  unit: { color: colors.muted, fontSize: 16 },
  missing: { color: colors.danger, fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  problem: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  flag: { minHeight: 44, justifyContent: 'center' },
  flagText: { color: colors.muted },
  flagActive: { color: colors.danger, fontWeight: '600' },
});
