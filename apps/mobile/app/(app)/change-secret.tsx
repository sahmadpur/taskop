import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { ChangeSecretScreen } from '@/features/profile/change-secret-screen';

export default function ChangeSecretRoute() {
  const { t } = useTranslation();
  return (
    <ChangeSecretScreen
      onDone={() => {
        Alert.alert(t('mobile.changeSecret.done'));
        router.back();
      }}
    />
  );
}
