import type { Me } from '@taskop/contracts';
import { Bell, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NotificationPreferencesDialog } from '@/features/notifications/preferences-dialog';

const THEMES = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

/** The header's name and role as a menu: notification preferences, and the light/dark/system appearance. */
export function UserMenu({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(false);
  const { theme, setTheme } = useTheme();
  return (
    <>
      {/* Not modal: the dialog opened from the item must get focus and pointer events. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto gap-2 py-1 text-right">
            <span className="grid text-sm">
              <span className="font-medium">{me.user.fullName}</span>
              <span className="text-muted-foreground text-xs">{me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name}</span>
            </span>
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setPreferences(true)}>
            <Bell aria-hidden />
            {t('notifications.preferences.menu')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('common.theme.label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
            {THEMES.map(({ value, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden />
                {t(`common.theme.${value}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationPreferencesDialog open={preferences} onOpenChange={setPreferences} />
    </>
  );
}
