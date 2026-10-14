import type { Me } from '@taskop/contracts';
import { Bell, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NotificationPreferencesDialog } from '@/features/notifications/preferences-dialog';

/** The header's name and role as a menu (decision 3): "Bildiriş ayarları" opens the preferences dialog. */
export function UserMenu({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(false);
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
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationPreferencesDialog open={preferences} onOpenChange={setPreferences} />
    </>
  );
}
