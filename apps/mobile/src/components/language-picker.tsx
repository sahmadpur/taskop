import { type Language, LANGUAGE_NAMES, LANGUAGES } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { chooseLanguage, useLocale } from '@/lib/language';
import { colors, font, radius, spacing, type } from '@/lib/theme';

/** Three chips, each language named in itself; the choice is stored on the phone and, when signed in, on the profile. On the sign-in screen and in the profile. */
export function LanguagePicker({ testID = 'language-picker' }: { testID?: string }) {
  const { t } = useTranslation();
  const current = useLocale();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} testID={testID} style={styles.row}>
      {LANGUAGES.map((lng: Language) => {
        const on = lng === current;
        return (
          <Pressable
            key={lng}
            accessibilityRole="radio"
            accessibilityLabel={LANGUAGE_NAMES[lng]}
            accessibilityState={{ selected: on, checked: on }}
            testID={`${testID}-${lng}`}
            onPress={() => void chooseLanguage(lng)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{LANGUAGE_NAMES[lng]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  text: { fontFamily: font, fontSize: type.base, fontWeight: '500', color: colors.text },
  textOn: { color: colors.primaryDeep, fontWeight: '600' },
});
