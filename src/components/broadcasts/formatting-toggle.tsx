'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
      <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
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
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 pointer-coarse:size-11"
        >
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="text-popover-foreground w-64 max-w-[calc(100vw-2rem)] gap-1 p-3 text-xs"
        >
          {t('formattingInfo')}
        </PopoverContent>
      </Popover>
    </div>
  );
}
