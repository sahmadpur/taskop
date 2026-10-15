import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing, type, TONES, type Tone } from '@/lib/theme';

/** A status chip: soft background, strong text, always with words. Shared by tasks, runs and cards. */
export function StatusChip({ text, tone = 'neutral', testID }: { text: string; tone?: Tone; testID?: string }) {
  const c = TONES[tone];
  return (
    <View testID={testID} style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

/** The deep header block at the top of the main screens: a line above (the date, a subtitle), the title, and tools. */
export const headerBlock = StyleSheet.create({
  block: { backgroundColor: colors.deep, borderRadius: radius.sheet, padding: spacing.md, paddingTop: spacing.lg, gap: spacing.xs },
  eyebrow: { fontFamily: font, color: colors.onDeepMuted, fontSize: type.sm },
  title: { fontFamily: font, color: colors.onDeep, fontSize: type.display, fontWeight: '600', letterSpacing: -0.5 },
  subtitle: { fontFamily: font, color: colors.onDeepMuted, fontSize: type.base },
  tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
});

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  text: { fontFamily: font, fontSize: type.sm, fontWeight: '600' },
});
