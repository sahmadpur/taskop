import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import type { EmployeeChoice } from './team-rules';

/** Spec §7.1: one employee of the period, or everyone. The choice is the screen's, and survives a period change (decision 6). */
export function EmployeePicker({ choices, selected, onChange }: { choices: EmployeeChoice[]; selected: EmployeeChoice | null; onChange: (c: EmployeeChoice | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = `${t('reports.filters.employee')}: ${selected?.name ?? t('reports.filters.allEmployees')}`;
  const pick = (c: EmployeeChoice | null) => {
    setOpen(false);
    onChange(c);
  };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={styles.button}>
        <Text style={styles.buttonText}>{label} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{t('reports.filters.employee')}</Text>
            <ScrollView contentContainerStyle={styles.options}>
              <Option label={t('reports.filters.allEmployees')} selected={selected === null} onPress={() => pick(null)} />
              {choices.map((c) => (
                <Option
                  key={c.userId}
                  label={c.active ? c.name : `${c.name} (${t('reports.inactive')})`}
                  selected={selected?.userId === c.userId}
                  onPress={() => pick(c)}
                />
              ))}
            </ScrollView>
            <PrimaryButton variant="outline" title={t('common.close')} onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected ? styles.optionOn : null]}>
      <Text style={[styles.optionText, selected ? styles.optionTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontSize: 15 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  options: { gap: spacing.sm },
  option: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  optionOn: { borderColor: colors.primary },
  optionText: { color: colors.text, fontSize: 15 },
  optionTextOn: { color: colors.primary, fontWeight: '600' },
});
