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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!form.busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md [&>[data-slot=dialog-close]]:size-10"
        showCloseButton={!form.busy}
      >
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
      <DialogHeader className="border-border shrink-0 border-b px-5 py-5 pr-14">
        <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
        <DialogDescription className="text-muted-foreground">
          {description}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
        <label
          htmlFor="broadcast-send-at"
          className="text-foreground block text-sm font-medium"
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
          disabled={busy}
          aria-describedby="broadcast-time-zone"
          aria-invalid={inPast}
          className="bg-background h-10"
        />
        <p
          id="broadcast-time-zone"
          className="text-muted-foreground text-xs leading-relaxed"
        >
          {t('timeZone', {
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })}
        </p>
        {inPast && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {t('pastError')}
          </p>
        )}
      </div>

      <DialogFooter className="mx-0 mb-0 shrink-0 flex-col px-5 py-4 sm:flex-row">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className="h-auto min-h-10 px-4 py-2 whitespace-normal"
        >
          {t('cancel')}
        </Button>
        <Button
          onClick={confirm}
          disabled={!value || busy}
          className="h-auto min-h-10 px-5 py-2 whitespace-normal"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
