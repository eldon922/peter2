'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

/**
 * Turns WhatsApp text formatting (*bold*, _italic_…) on or off in a preview.
 * Only the preview changes — the info button says so.
 */
export function FormattingToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useTranslations('Broadcasts.wizard');
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
        {t('applyFormatting')}
      </label>
      {/* Outside the label so tapping it doesn't flip the switch. */}
      <Popover>
        <PopoverTrigger
          // Opens on hover; a tap still opens it on touch screens.
          openOnHover
          delay={100}
          closeDelay={150}
          aria-label={t('formattingInfoLabel')}
          className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 max-w-[calc(100vw-2rem)] gap-1 p-3 text-xs text-popover-foreground"
        >
          {t('formattingInfo')}
        </PopoverContent>
      </Popover>
    </div>
  );
}
