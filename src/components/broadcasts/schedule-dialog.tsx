'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toDateTimeLocal } from '@/lib/broadcasts/schedule';

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** ISO time the picker starts on; empty when nothing is chosen yet. */
  initialAt?: string;
  busy?: boolean;
  /** Called with the chosen time as an ISO string. */
  onConfirm: (iso: string) => void;
}

/** Asks for a send time. Shared by scheduling (wizard) and editing (details page). */
export function ScheduleDialog({
  open,
  onOpenChange,
  ...form
}: ScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        {/* Mounted only while open, so each opening starts fresh. */}
        <ScheduleForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  title,
  description,
  confirmLabel,
  initialAt,
  busy,
  onConfirm,
  onCancel,
}: Omit<ScheduleDialogProps, 'open' | 'onOpenChange'> & {
  onCancel: () => void;
}) {
  const t = useTranslations('Broadcasts.schedule');
  const [value, setValue] = useState(
    initialAt ? toDateTimeLocal(new Date(initialAt)) : ''
  );
  const [min] = useState(() => toDateTimeLocal(new Date()));
  const [inPast, setInPast] = useState(false);

  function confirm() {
    const picked = new Date(value);
    if (!(picked.getTime() > Date.now())) {
      setInPast(true);
      return;
    }
    onConfirm(picked.toISOString());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
        <DialogDescription className="text-muted-foreground">
          {description}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <label
          htmlFor="broadcast-send-at"
          className="block text-sm font-medium text-foreground"
        >
          {t('sendAt')}
        </label>
        <Input
          id="broadcast-send-at"
          type="datetime-local"
          value={value}
          min={min}
          onChange={(e) => {
            setValue(e.target.value);
            setInPast(false);
          }}
          aria-invalid={inPast}
          className="border-border bg-muted text-foreground"
        />
        <p className="text-xs text-muted-foreground">
          {t('timeZone', {
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })}
        </p>
        {inPast && <p className="text-xs text-red-400">{t('pastError')}</p>}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className="border-border text-muted-foreground"
        >
          {t('cancel')}
        </Button>
        <Button
          onClick={confirm}
          disabled={!value || busy}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
