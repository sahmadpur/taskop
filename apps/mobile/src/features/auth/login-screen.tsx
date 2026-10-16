import { loginStaffInputSchema, loginWorkerInputSchema } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { LanguagePicker } from '@/components/language-picker';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, session } from '@/lib/session';
import { colors, font, radius, spacing, type } from '@/lib/theme';
import markWhite from '../../../assets/mark-white.png';

type Mode = 'worker' | 'staff';

export function LoginScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('worker');
  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void session.getOrgCode().then((code) => {
      if (code) setOrgCode((current) => current || code);
    });
  }, []);

  const submit = async () => {
    setError(null);
    const parsed =
      mode === 'worker'
        ? loginWorkerInputSchema.safeParse({ orgCode, username, secret, client: 'mobile' })
        : loginStaffInputSchema.safeParse({ email, password, client: 'mobile' });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      if (parsed.data && 'orgCode' in parsed.data) {
        const result = await api.auth.loginWorker(parsed.data);
        await session.rememberOrgCode(parsed.data.orgCode);
        await session.signedIn(result);
      } else {
        await session.signedIn(await api.auth.loginStaff(parsed.data));
      }
    } catch (e) {
      setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) => (fieldErrors[name] ? t(fieldErrors[name]) : null);

  return (
    <Screen>
      <View style={styles.brand}>
        <Image source={markWhite} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text style={styles.brandName}>Taskop</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {t('mobile.login.title')}
        </Text>
      </View>
      <LanguagePicker />
      <View style={styles.toggle} accessibilityRole="tablist">
        {(['worker', 'staff'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
            style={[styles.toggleItem, mode === m && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{t(`mobile.login.${m}`)}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'worker' ? (
        <>
          <Field label={t('mobile.login.orgCode')} value={orgCode} onChangeText={setOrgCode} autoCapitalize="none" error={fieldError('orgCode')} />
          <Field label={t('mobile.login.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" error={fieldError('username')} />
          <Field label={t('mobile.login.secret')} value={secret} onChangeText={setSecret} secureTextEntry autoComplete="password" error={fieldError('secret')} />
        </>
      ) : (
        <>
          <Field label={t('mobile.login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={fieldError('email')} />
          <Field label={t('mobile.login.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={fieldError('password')} />
        </>
      )}
      <FormError message={error} />
      <PrimaryButton title={t('mobile.login.submit')} onPress={() => void submit()} disabled={busy} />
      <Text style={styles.hint}>{t('mobile.login.hint')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { backgroundColor: colors.deep, borderRadius: radius.sheet, padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.xs, marginTop: spacing.sm },
  mark: { width: 44, height: 44, marginBottom: spacing.sm },
  brandName: { fontFamily: font, fontSize: type.md, fontWeight: '600', color: colors.onDeepMuted, letterSpacing: -0.2 },
  title: { fontFamily: font, fontSize: type.display, fontWeight: '600', color: colors.onDeep, letterSpacing: -0.5, lineHeight: 36 },
  toggle: { flexDirection: 'row', backgroundColor: colors.plannedSoft, borderRadius: radius.control, padding: 4 },
  toggleItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - 3 },
  toggleActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  toggleText: { fontFamily: font, fontSize: type.base, color: colors.muted, fontWeight: '500' },
  toggleTextActive: { color: colors.text, fontWeight: '600' },
  hint: { fontFamily: font, fontSize: type.base, color: colors.muted, textAlign: 'center' },
});
