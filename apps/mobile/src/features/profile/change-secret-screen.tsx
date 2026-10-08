import { ApiError } from '@taskop/api-client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api } from '@/lib/session';
import { colors } from '@/lib/theme';

export function ChangeSecretScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [currentSecret, setCurrent] = useState('');
  const [newSecret, setNext] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setFields({});
    if (!currentSecret || !newSecret) {
      setFields({
        ...(currentSecret ? {} : { currentSecret: 'errors.validation.required' }),
        ...(newSecret ? {} : { newSecret: 'errors.validation.required' }),
      });
      return;
    }
    setBusy(true);
    try {
      await api.auth.changeCredential({ currentSecret, newSecret });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={{ fontSize: 20, fontWeight: '600', color: colors.text }}>{t('mobile.changeSecret.title')}</Text>
      <Field label={t('mobile.changeSecret.current')} value={currentSecret} onChangeText={setCurrent} secureTextEntry error={fields.currentSecret ? t(fields.currentSecret) : null} />
      <Field label={t('mobile.changeSecret.next')} value={newSecret} onChangeText={setNext} secureTextEntry error={fields.newSecret ? t(fields.newSecret) : null} />
      <FormError message={error} />
      <PrimaryButton title={t('mobile.changeSecret.submit')} onPress={() => void submit()} disabled={busy} />
    </Screen>
  );
}
