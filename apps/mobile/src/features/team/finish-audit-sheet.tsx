import { AUDIT_LIMITS, AUDIT_RESULTS, type AuditResult, type FinishAuditInput, finishAuditInputSchema, reportRecipients } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormError } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Choice } from '@/features/execution/parts';
import { colors, spacing } from '@/lib/theme';

/** Extra report addresses as typed: separated by commas, semicolons or spaces. */
export const parseEmails = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean);

interface Props {
  /** The checklist's own report addresses, shown read-only. */
  reportEmails: readonly string[];
  online: boolean;
  busy: boolean;
  /** Resolves to the server's refusal to show here, or null when the sheet is done. */
  onSave: (body: FinishAuditInput) => Promise<string | null>;
  onClose: () => void;
}

/** FR-19.06–08: the result, a final comment and extra report addresses (`finishAuditInputSchema` lower-cases and de-duplicates them). */
export function FinishAuditSheet({ reportEmails, online, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [result, setResult] = useState<AuditResult>('passed');
  const [comment, setComment] = useState('');
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const extraEmails = parseEmails(emails);
    // The server refuses the merged list (the checklist's addresses plus these), not just the extras.
    if (reportRecipients(reportEmails, extraEmails.map((e) => e.toLowerCase())).length > AUDIT_LIMITS.recipients) return setError(t('audits.issues.tooManyEmails'));
    const parsed = finishAuditInputSchema.safeParse({ result, comment: comment.trim() ? comment : null, extraEmails });
    if (!parsed.success) return setError(t('mobile.team.audit.invalidEmails'));
    setError(await onSave(parsed.data));
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView testID="finish-sheet" style={styles.sheet} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('mobile.team.audit.finishTitle')}</Text>
          <Text style={styles.label}>{t('audits.fields.result')}</Text>
          <View style={styles.row}>
            {AUDIT_RESULTS.map((r) => (
              <Choice key={r} role="radio" label={t(`audits.results.${r}`)} selected={result === r} onPress={() => setResult(r)} />
            ))}
          </View>
          <Text style={styles.label}>{t('audits.fields.comment')}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.comment')}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={AUDIT_LIMITS.finalComment}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.muted}>
            {reportEmails.length > 0 ? t('mobile.team.audit.reportTo', { emails: reportEmails.join(', ') }) : t('mobile.team.audit.noReportEmails')}
          </Text>
          <Text style={styles.label}>{t('audits.fields.extraEmails')}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.extraEmails')}
            value={emails}
            onChangeText={(text) => {
              setError(null);
              setEmails(text);
            }}
            placeholder={t('mobile.team.audit.emailsHint')}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={colors.muted}
            style={styles.line}
          />
          <FormError message={error} />
          {!online ? <Text style={styles.muted}>{t('mobile.team.offline')}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
            <PrimaryButton title={t('audits.actions.finish')} disabled={!online || busy} onPress={() => void save()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { flexGrow: 0, maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  line: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
});
