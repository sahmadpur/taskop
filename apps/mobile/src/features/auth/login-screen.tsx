import { loginStaffInputSchema, loginWorkerInputSchema } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, session } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';

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
      <Text style={styles.brand}>Taskop</Text>
      <Text style={styles.title}>{t('mobile.login.title')}</Text>
      <View style={styles.toggle}>
        {(['worker', 'staff'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
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
  brand: { fontSize: 28, fontWeight: '700', color: colors.primary, marginTop: spacing.lg },
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
  toggle: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 4 },
  toggleItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  toggleActive: { backgroundColor: colors.surface },
  toggleText: { color: colors.muted, fontWeight: '500' },
  toggleTextActive: { color: colors.text },
  hint: { color: colors.muted, textAlign: 'center' },
});
