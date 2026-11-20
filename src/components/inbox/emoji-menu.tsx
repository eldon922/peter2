'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const Picker = dynamic(() => import('emoji-picker-react'), { ssr: false });

export function EmojiMenu({ label, disabled, onPick, onOpenChange }: {
  label: string;
  disabled?: boolean;
  onPick: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  function toggle(value: boolean) {
    setOpen(value);
    onOpenChange?.(value);
  }
  return <Popover open={open} onOpenChange={toggle}>
    <PopoverTrigger disabled={disabled} aria-label={label} title={label} className="hover:bg-muted grid size-8 shrink-0 place-items-center rounded-full"><SmilePlus className="size-4" /></PopoverTrigger>
    <PopoverContent className="w-auto p-0">
      {open && <Picker theme="auto" emojiStyle="native" width="min(340px, 90vw)" height="min(400px, 55dvh)" onEmojiClick={({emoji}) => { toggle(false); onPick(emoji); }} />}
    </PopoverContent>
  </Popover>;
}
