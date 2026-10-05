'use client';

import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';

/** Turns WhatsApp text formatting (*bold*, _italic_…) on or off in a preview. */
export function FormattingToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useTranslations('Broadcasts.wizard');
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      {t('applyFormatting')}
    </label>
  );
}
