import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/session';

export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <div className="grid max-w-2xl gap-3">
      <h1 className="text-2xl font-semibold">{t('nav.welcome', { name: me.user.fullName.split(' ')[0] })}</h1>
      <p className="text-muted-foreground">{t('nav.intro')}</p>
    </div>
  );
}
