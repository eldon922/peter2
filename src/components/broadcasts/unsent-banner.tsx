'use client';

import { useState } from 'react';
import { CalendarClock, Loader2, Pencil, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScheduleDialog } from '@/components/broadcasts/schedule-dialog';
import { formatScheduledAt } from '@/lib/broadcasts/schedule';

interface UnsentBannerProps {
  broadcast: Broadcast;
  canSend: boolean;
  /** Reloads the broadcast after anything changed. */
  onChange: () => Promise<void>;
}

type Action = 'start' | 'schedule' | 'cancel';

/**
 * What a broadcast can do before it goes out. Scheduled: start now, edit
 * the time, cancel. A draft that has recipients (a cancelled schedule):
 * start now, or schedule it again.
 */
export function UnsentBanner({
  broadcast,
  canSend,
  onChange,
}: UnsentBannerProps) {
  const t = useTranslations('Broadcasts.detail');
  const isDraft = broadcast.status === 'draft';
  const [confirming, setConfirming] = useState<'start' | 'cancel' | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);

  async function start() {
    setBusy('start');
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}/start`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.code === 'conflict'
            ? t('toastNoLongerScheduled')
            : t('toastStartFailed', { error: data.error ?? 'Unknown error' })
        );
      }
    } catch (err) {
      toast.error(
        t('toastStartFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
    setConfirming(null);
    setBusy(null);
    await onChange();
  }

  // Guarded on the status this page showed, so it can't undo the cron (or
  // "Start now") that started the broadcast a moment ago — then no row
  // matches.
  async function update(
    action: 'schedule' | 'cancel',
    values: { status: 'draft' | 'scheduled'; scheduled_at: string | null },
    success: string
  ) {
    setBusy(action);
    const { data, error } = await createClient()
      .from('broadcasts')
      .update(values)
      .eq('id', broadcast.id)
      .eq('status', broadcast.status)
      .select('id');
    setBusy(null);
    if (error) {
      toast.error(t('toastScheduleFailed', { error: error.message }));
      return;
    }
    if (data?.length) toast.success(success);
    else toast.error(t('toastNoLongerScheduled'));
    setScheduling(false);
    setConfirming(null);
    await onChange();
  }

  const disabled = busy !== null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        isDraft ? 'border-border bg-card' : 'border-blue-500/20 bg-blue-500/5'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <CalendarClock
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              isDraft ? 'text-muted-foreground' : 'text-blue-400'
            }`}
          />
          <div>
            {isDraft ? (
              <p className="text-sm font-medium text-foreground">
                {t('draftTitle')}
              </p>
            ) : (
              broadcast.scheduled_at && (
                <p className="text-sm font-medium text-foreground">
                  {t('scheduledFor', {
                    time: formatScheduledAt(broadcast.scheduled_at),
                  })}
                </p>
              )
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {isDraft ? t('draftHint') : t('scheduledHint')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GatedButton
            canAct={canSend}
            gateReason="start broadcasts"
            size="sm"
            disabled={disabled}
            onClick={() => setConfirming('start')}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Play className="h-3.5 w-3.5" />
            {t('startNow')}
          </GatedButton>
          <GatedButton
            canAct={canSend}
            gateReason={isDraft ? 'schedule broadcasts' : 'edit schedules'}
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setScheduling(true)}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {isDraft ? (
              <CalendarClock className="h-3.5 w-3.5" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
            {isDraft ? t('schedule') : t('editSchedule')}
          </GatedButton>
          {!isDraft && (
            <GatedButton
              canAct={canSend}
              gateReason="cancel schedules"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setConfirming('cancel')}
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10"
            >
              <X className="h-3.5 w-3.5" />
              {t('cancelSchedule')}
            </GatedButton>
          )}
        </div>
      </div>

      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        title={isDraft ? t('scheduleTitle') : t('editScheduleTitle')}
        description={isDraft ? t('scheduleDesc') : t('editScheduleDesc')}
        confirmLabel={isDraft ? t('schedule') : t('editScheduleConfirm')}
        initialAt={broadcast.scheduled_at ?? undefined}
        busy={busy === 'schedule'}
        onConfirm={(iso) =>
          update(
            'schedule',
            { status: 'scheduled', scheduled_at: iso },
            isDraft
              ? t('toastScheduled', { time: formatScheduledAt(iso) })
              : t('toastScheduleSaved')
          )
        }
      />

      <ConfirmDialog
        open={confirming === 'start'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('startConfirmTitle')}
        description={t('startConfirmDesc', { count: broadcast.total_recipients })}
        cancelLabel={t('cancel')}
        confirmLabel={t('startNow')}
        busy={busy === 'start'}
        onConfirm={start}
      />
      <ConfirmDialog
        open={confirming === 'cancel'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('cancelConfirmTitle')}
        description={t('cancelConfirmDesc')}
        cancelLabel={t('keepSchedule')}
        confirmLabel={t('cancelSchedule')}
        destructive
        busy={busy === 'cancel'}
        onConfirm={() =>
          update(
            'cancel',
            { status: 'draft', scheduled_at: null },
            t('toastScheduleCancelled')
          )
        }
      />
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="border-border text-muted-foreground"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
