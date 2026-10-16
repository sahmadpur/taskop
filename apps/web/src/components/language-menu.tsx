import { type Language, LANGUAGE_NAMES, LANGUAGES } from '@taskop/i18n';
import { Check, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { setLanguage, useLocale } from '@/lib/i18n';

/**
 * The language selector: a globe button opening the three languages, each named in itself. The choice is kept in
 * localStorage (decision: no server-side preference yet). `compact` shows only the icon, for the app header.
 */
export function LanguageMenu({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const current = useLocale();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'default'} aria-label={`${t('common.language')}: ${LANGUAGE_NAMES[current]}`} className={className}>
          <Languages aria-hidden />
          {!compact && <span>{LANGUAGE_NAMES[current]}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" aria-label={t('common.language')}>
        {LANGUAGES.map((lng: Language) => (
          <DropdownMenuItem key={lng} lang={lng} aria-current={lng === current ? 'true' : undefined} onSelect={() => void setLanguage(lng)}>
            <span className="flex-1">{LANGUAGE_NAMES[lng]}</span>
            {lng === current && <Check aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
