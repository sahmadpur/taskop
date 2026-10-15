import { AUDIT_LIMITS, auditVerdictInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormError } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';

interface Props {
  itemLabel: string;
  initial: string;
  online: boolean;
  busy: boolean;
  /** Resolves to the server's refusal to show here (the sheet covers the panel's own message), or null when it is done. */
  onSave: (comment: string) => Promise<string | null>;
  onClose: () => void;
}

/** FR-19.05: rejecting an item needs a comment (`auditVerdictInputSchema`). */
export function VerdictSheet({ itemLabel, initial, online, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [comment, setComment] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const parsed = auditVerdictInputSchema.safeParse({ verdict: 'rejected', comment });
    if (!parsed.success || !parsed.data.comment) return setError(t('audits.issues.commentRequired'));
    setError(await onSave(parsed.data.comment));
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View testID="verdict-sheet" style={styles.sheet}>
          <Text style={styles.title}>{t('mobile.team.audit.rejectTitle')}</Text>
          <Text style={styles.muted}>{itemLabel}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.comment')}
            value={comment}
            onChangeText={(text) => {
              setError(null);
              setComment(text);
            }}
            multiline
            maxLength={AUDIT_LIMITS.verdictComment}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <FormError message={error} />
          {!online ? <Text style={styles.muted}>{t('mobile.team.offline')}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
            <PrimaryButton title={t('audits.actions.reject')} disabled={!online || busy} onPress={() => void save()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
