'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';
import { isValidHttpUrl, numberChanged } from '@/lib/broadcasts/variables';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  RotateCw,
  AlertTriangle,
  ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
  percentOfRecipients,
  recipientStatusConfig,
  statusTextClass,
} from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct = percentOfRecipients(value, total);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary". */
  color: string;
  /** Text colour that reads on top of `color`, in both themes. */
  onColor: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars, each labelled
 * with its count and its share of the audience.
 *
 * Measured against **Sent**, so the top bar is always 100% and each step
 * below reads as "of the messages that went out, this many got here".
 * That is deliberately a different denominator from the stat cards and
 * the list page, which are shares of the whole audience — so the header
 * spells the basis out. Without that label the two readings of the same
 * broadcast look like a bug.
 *
 * Both the bar width and the percentage use that one denominator, so a
 * bar's length and its own label always say the same thing.
 *
 * The label sits *inside* the bar, which is where it reads best but also
 * where colour gets hard: `text-foreground` is near-black on indigo in
 * light mode and near-white on green-500 in dark, and a short bar leaves
 * half the text hanging off the fill onto the muted track. Rather than
 * pick one colour that loses somewhere, the label is drawn twice — once
 * in `text-foreground` for the track, and again in the fill's own
 * foreground colour inside a box clipped to the fill. Each pixel of text
 * is then painted in the colour that suits whatever is behind it, at any
 * bar width, in either theme. Nothing is dimmed with `opacity`: a
 * washed-out percentage was the first thing to become unreadable on the
 * light-mode track.
 */
function FunnelChart({ steps, sent }: { steps: FunnelStep[]; sent: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">
        Funnel
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          % of sent
        </span>
      </h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pct = percentOfRecipients(step.value, sent);
          // Keep a sliver visible for any step that isn't zero — a step
          // one person in a thousand reached should still be findable —
          // but never draw a bar for a step nobody reached.
          const width = step.value > 0 ? Math.max(2, pct) : 0;
          const label = (
            <>
              {step.value.toLocaleString()}
              <span className="ml-1.5 font-normal">({pct}%)</span>
            </>
          );
          return (
            // The label column is fixed-width, so on a phone it was
            // eating the row and leaving the bar a stub — it shrinks
            // below sm to give the bar room.
            <div key={step.label} className="flex items-center gap-2 sm:gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground sm:w-20">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${width}%` }}
                />
                <span className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap px-3 text-xs font-semibold tabular-nums text-foreground">
                  {label}
                </span>
                {/* Same label, same position, clipped to the fill. Purely
                    presentational — the copy above is the one screen
                    readers announce. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-500"
                  style={{ width: `${width}%` }}
                >
                  <span
                    className={`flex h-full items-center whitespace-nowrap px-3 text-xs font-semibold tabular-nums ${step.onColor}`}
                  >
                    {label}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/**
 * Timestamp lines in the recipients table are tinted to match the status
 * chip of the step each one records, so "delivered" reads the same green
 * whether you're looking at the chip, the funnel bar, or the time.
 */
const STAMP_TINTS = {
  sent: statusTextClass(recipientStatusConfig.sent),
  delivered: statusTextClass(recipientStatusConfig.delivered),
  read: statusTextClass(recipientStatusConfig.read),
} as const;

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Cadence while a fan-out is live. Matches the broadcasts list page. */
const POLL_INTERVAL_MS = 5000;

/**
 * Cadence once the fan-out is done. The page keeps polling either way —
 * see the effect below — but at a sixth the rate, because the recipients
 * query joins every row of the broadcast and a tab left open on a
 * 10k-recipient send shouldn't re-pull all of it every five seconds.
 */
const IDLE_POLL_INTERVAL_MS = 30000;

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const broadcastId = params.id as string;
  const canSend = useCan('send-messages');

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Broadcast id while a bulk retry is in flight, or a recipient id for a row retry. */
  const [retrying, setRetrying] = useState<string | null>(null);
  /**
   * Set right after the server accepts a retry, so the progress bar
   * below can track just *that* retry's slice rather than the whole
   * broadcast. `baseline` is sent_count + failed_count at the moment
   * the retry was accepted; `total` is how many rows it claimed. As
   * polling advances those counts, (current - baseline) / total is
   * this retry's own 0–100, distinct from the wizard's initial-send
   * case below where there is no baseline to subtract.
   */
  const [retryTarget, setRetryTarget] = useState<{
    total: number;
    baseline: number;
  } | null>(null);
  /**
   * Set when the server refused a retry because it can't tell which
   * media this broadcast sent. Holds the pending retry's scope so
   * answering the prompt resumes exactly what was clicked.
   */
  const [mediaPrompt, setMediaPrompt] = useState<{
    recipientId?: string;
    url: string;
    /** The server's explanation, shown as the dialog description. */
    error: string;
    /** image | video | document — drives the label and the preview. */
    headerType: string;
  } | null>(null);

  // Same validation the personalize step applies to a media header, so
  // a URL rejected there is rejected here and vice versa.
  const mediaPromptError = useMemo<'missing' | 'invalid' | null>(() => {
    if (!mediaPrompt) return null;
    const value = mediaPrompt.url.trim();
    if (!value) return 'missing';
    if (!isValidHttpUrl(value)) return 'invalid';
    return null;
  }, [mediaPrompt]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Plain function rather than useCallback, matching the broadcasts
  // list page: the polling effect below re-reads it on every tick and
  // keys off `isSending` alone, so a stable identity buys nothing.
  async function refresh() {
    try {
      const supabase = createClient();

      const { data: bc, error: bcError } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

      if (bcError) throw bcError;
      setBroadcast(bc);

      // Most recently delivered first. Rows never sent (pending, and
      // failures that never got a wamid) have no sent_at, so they sort
      // to the end rather than being scattered through the list.
      //
      // `id` is a tiebreaker, not decoration. Every unsent row ties on
      // a NULL sent_at, and created_at can't break it either — it
      // defaults to NOW(), the *transaction* timestamp, so all 200 rows
      // of a batch insert share one value. Unresolved ties let Postgres
      // return rows in physical heap order, and an UPDATE writes a new
      // row version elsewhere in the heap — which is why a retried row
      // used to jump position for no visible reason.
      const { data: recs, error: recsError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });

      if (recsError) throw recsError;
      setRecipients(recs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [broadcastId]);

  // Poll for as long as this page is open, not just while the fan-out is
  // running. The send is only the first half of a broadcast's life:
  // delivered / read / replied all land later, by webhook, long after
  // `status` has flipped off 'sending'. Gating the timer on `isSending`
  // froze the funnel and the recipient rows the moment the last message
  // went out, so every number after "Sent" sat stale until a manual
  // reload — the page looked finished while the data behind it was still
  // moving.
  //
  // `isSending` now selects the cadence rather than switching polling on
  // and off, and the timer still pauses while the tab is hidden, so a
  // backgrounded tab costs nothing.
  const isSending = broadcast?.status === 'sending';
  useEffect(() => {
    const intervalMs = isSending ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;

    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(refresh, intervalMs);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    function handleVisibilityChange() {
      if (!isSending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        refresh();
        startPolling();
      }
    }

    if (isSending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSending]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  /**
   * Retry every failed recipient, or just one when `recipientId` is
   * given. The server claims the rows and fans out after responding,
   * so we refresh immediately and let polling carry the rest.
   */
  async function handleRetry(recipientId?: string) {
    if (!broadcast) return;
    setRetrying(recipientId ?? broadcast.id);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(recipientId ? { recipient_id: recipientId } : {}),
          // Only present after the user answered the media prompt below.
          ...(mediaPrompt?.url.trim()
            ? { header_media_url: mediaPrompt.url.trim() }
            : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The server refuses rather than guessing whenever it can't
        // reproduce the original message. Two of those refusals are
        // answerable by the user, so ask instead of just reporting.
        if (data.code === 'header_media_required') {
          setMediaPrompt({
            recipientId,
            url: '',
            error: data.error,
            headerType: data.headerType ?? 'image',
          });
          return;
        }
        toast.error(
          data.code === 'params_unrecoverable'
            ? t('toastRetryUnrecoverable')
            : data.code === 'template_missing'
              ? t('toastRetryTemplateMissing')
              : t('toastRetryFailed', { error: data.error ?? 'Unknown error' }),
        );
        return;
      }

      setMediaPrompt(null);

      if (data.retrying > 0) {
        // Snapshot before `refresh()` below moves the counts — this is
        // the "before" the progress bar measures forward from.
        setRetryTarget({
          total: data.retrying,
          baseline: broadcast.sent_count + broadcast.failed_count,
        });
      }

      if (data.retrying === 0) {
        toast.info(t('noFailedToRetry'));
      } else if (data.remaining > 0) {
        toast.success(
          t('toastRetryPartial', {
            count: data.retrying,
            remaining: data.remaining,
          }),
        );
      } else {
        toast.success(t('toastRetryStarted', { count: data.retrying }));
      }
      await refresh();
    } catch (err) {
      toast.error(
        t('toastRetryFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
    } finally {
      setRetrying(null);
    }
  }

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.phoneAttempted'),
      t('table.status'),
      t('table.attempts'),
      t('table.sent'),
      t('table.delivered'),
      t('table.read'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.phone_attempted ?? '',
      r.status,
      String(r.attempt_count ?? 1),
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/broadcasts');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  // Same 0–100 shape as the wizard's Step4ScheduleSend "Processing"
  // overlay, driven by polling instead of a client-tracked counter
  // since the fan-out itself now always runs server-side (both a
  // fresh wizard send and a retry — see use-broadcast-sending.ts and
  // /api/broadcasts/[id]/send).
  //
  // `retryTarget` set: scope to just that retry's claimed rows, so the
  // bar moves visibly even when it's a handful of rows against a
  // broadcast of thousands.
  // `retryTarget` unset but still 'sending': this is either a fresh
  // send just kicked off by the wizard (no retry was ever clicked on
  // this page) or a page load that landed mid-send from elsewhere —
  // either way, fall back to overall completion.
  const completedCount = broadcast.sent_count + broadcast.failed_count;
  const sendProgress = retryTarget
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((completedCount - retryTarget.baseline) / retryTarget.total) * 100,
          ),
        ),
      )
    : broadcast.total_recipients > 0
      ? Math.min(100, Math.round((completedCount / broadcast.total_recipients) * 100))
      : 0;

  // `onColor` is the text colour drawn on top of each fill. The primary
  // bar uses the theme's paired token; the three raw Tailwind fills are
  // saturated enough at 500 that white reads on them in both themes.
  const funnelSteps: FunnelStep[] = [
    { label: t('stats.sent'), value: broadcast.sent_count, color: 'bg-primary', onColor: 'text-primary-foreground' },
    { label: t('stats.delivered'), value: broadcast.delivered_count, color: 'bg-green-500', onColor: 'text-white' },
    { label: t('stats.read'), value: broadcast.read_count, color: 'bg-blue-500', onColor: 'text-white' },
    { label: t('stats.replied'), value: broadcast.replied_count, color: 'bg-indigo-500', onColor: 'text-white' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            className="border-border shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            {/* Wraps rather than truncates — the name is the thing you
                came here to identify, so it gets as many lines as it
                needs. `break-words` handles an unspaced run. */}
            <h1 className="text-2xl font-bold break-words text-foreground">
              {broadcast.name}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{t('template', { name: broadcast.template_name })}</span>
              <span>-</span>
              <span>
                {t('createdAt', { date: new Date(broadcast.created_at).toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>

        {/* The status chip lives with the actions at every width — one
            row holding "what state is this in" and "what can I do about
            it". `w-full` below md guarantees that row is its own line
            (with the chip at its left end) instead of wrapping
            unpredictably; from md up it shrinks to sit beside the title. */}
        <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
        <span className={`inline-flex shrink-0 ${statusChipClass}`}>
          {tStatus(status.label)}
        </span>

        <div className="flex items-center gap-2">
        {/* Retry failed — re-sends only the failed rows, folding the
            results back into this broadcast's funnel. Disabled while a
            fan-out is live so we never race the in-flight send. */}
        {broadcast.failed_count > 0 && (
          <GatedButton
            canAct={canSend}
            gateReason="send messages"
            variant="outline"
            size="sm"
            disabled={broadcast.status === 'sending' || retrying !== null}
            onClick={() => handleRetry()}
            title={
              broadcast.status === 'sending'
                ? t('cannotRetrySending')
                : t('retryHover')
            }
            className="border-amber-500/30 bg-transparent text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${retrying === broadcast.id ? 'animate-spin' : ''}`}
            />
            {retrying === broadcast.id
              ? t('retrying')
              : t('retryFailed', { count: broadcast.failed_count })}
          </GatedButton>
        )}

        {/* Delete — inline-confirm pattern matches the pipeline-settings
            "Delete Pipeline" flow. Mid-send broadcasts can't be deleted
            because orphaning in-flight Meta messages would leave the
            funnel inconsistent. */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
            <span className="text-red-300">{t('deletePrompt')}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? t('deleting') : t('confirm')}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={broadcast.status === 'sending'}
            onClick={() => setConfirmDelete(true)}
            title={
              broadcast.status === 'sending'
                ? t('cannotDeleteSending')
                : t('deleteHover')
            }
            className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('delete')}
          </Button>
        )}
        </div>
      </div>

      {/* Sending progress — shown whenever the fan-out is actually
          running server-side, whether that's the wizard's initial send
          (just navigated here) or a retry kicked off from the button
          above. Same visual shape as the wizard's own processing
          overlay (Step4ScheduleSend), driven by polling instead of a
          client-side counter. */}
      {broadcast.status === 'sending' && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {t('sendingProgress')}
              </p>
            </div>
            <span className="text-xs font-medium text-primary">{sendProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${sendProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Media prompt — the server refuses to guess which
          image/video/document this broadcast originally sent, because
          reusing the template's current default could re-send
          different content with no indication anything changed. Ask
          instead; the answer is stored on the broadcast, so this
          appears once. Validation mirrors the personalize step. */}
      {mediaPrompt && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium text-amber-300">
                  {t('mediaPromptTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mediaPrompt.error}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('mediaPromptLabel')}
                  </label>
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase text-primary">
                    {mediaPrompt.headerType}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="url"
                    autoFocus
                    value={mediaPrompt.url}
                    onChange={(e) =>
                      setMediaPrompt({ ...mediaPrompt, url: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && mediaPromptError === null) {
                        handleRetry(mediaPrompt.recipientId);
                      }
                    }}
                    placeholder={t('mediaPromptPlaceholder')}
                    className="min-w-[18rem] flex-1 border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                  <Button
                    size="sm"
                    disabled={mediaPromptError !== null || retrying !== null}
                    onClick={() => handleRetry(mediaPrompt.recipientId)}
                    className="bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {retrying !== null ? t('retrying') : t('mediaPromptConfirm')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retrying !== null}
                    onClick={() => setMediaPrompt(null)}
                    className="border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    {t('cancel')}
                  </Button>
                </div>
                {/* Only images can be previewed inline; video/document
                    URLs are taken on trust, same as the wizard. */}
                {mediaPrompt.headerType === 'image' &&
                  mediaPromptError === null && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaPrompt.url.trim()}
                      alt={t('mediaPromptPreviewAlt')}
                      className="mt-3 max-h-40 rounded-lg border border-border object-contain"
                    />
                  )}
                {mediaPromptError === 'invalid' && (
                  <p className="text-xs text-amber-300">{t('mediaPromptInvalid')}</p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">{t('mediaPromptHint')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats — 6 cards: Total / Sent / Delivered / Read / Replied / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label={t('stats.totalRecipients')}
          value={broadcast.total_recipients}
          total={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
        />
        <StatCard
          label={t('stats.sent')}
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label={t('stats.delivered')}
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-green-500/10 text-green-400"
        />
        <StatCard
          label={t('stats.read')}
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label={t('stats.replied')}
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label={t('stats.failed')}
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      <FunnelChart steps={funnelSteps} sent={broadcast.sent_count} />

      {/* Recipients Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {statusFilter !== 'all'
              ? t('recipientsHeader', { filtered: filteredRecipients.length, total: recipients.length })
              : t('recipientsHeaderAll', { total: recipients.length })}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-muted-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tStatus(getRecipientStatus(statusFilter).label)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-primary' : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    }
                  >
                    {tStatus(getRecipientStatus(s).label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {t('exportCsv')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? t('noRecipients')
                : t('noRecipientsFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t('table.contact')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.phone')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                  {/* Cells here only ever hold "×2", so the word
                      "Attempts" was setting this column's width by
                      itself. Icon + tooltip keeps it narrow. */}
                  <TableHead className="text-muted-foreground">
                    <span className="inline-flex" title={t('table.attempts')}>
                      <RotateCw className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">{t('table.attempts')}</span>
                    </span>
                  </TableHead>
                  <TableHead className="text-muted-foreground">{t('table.timestamps')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.error')}</TableHead>
                  <TableHead className="text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  // The contact was edited since this row was dialled,
                  // so what's displayed is NOT what was messaged. Shown
                  // on any status — a delivered row whose contact moved
                  // is just as misleading as a failed one.
                  const changed = numberChanged(recipient);
                  const attempts = recipient.attempt_count ?? 1;
                  // Sent/delivered/read share one column, one line per
                  // step the message actually reached — a missing line
                  // means that step never happened, not that it's late.
                  const stamps = [
                    {
                      label: t('table.sent'),
                      at: recipient.sent_at,
                      tint: STAMP_TINTS.sent,
                    },
                    {
                      label: t('table.delivered'),
                      at: recipient.delivered_at,
                      tint: STAMP_TINTS.delivered,
                    },
                    {
                      label: t('table.read'),
                      at: recipient.read_at,
                      tint: STAMP_TINTS.read,
                    },
                  ].flatMap(({ label, at, tint }) =>
                    at
                      ? [{ label, tint, value: new Date(at).toLocaleString() }]
                      : [],
                  );
                  // Rendered in the phone column at sm+, and stacked under
                  // the contact name below it. The number-changed warning
                  // has to travel with whichever one is showing — it's the
                  // only signal that the row was dialled at a number the
                  // contact no longer has.
                  const phoneBlock = (
                    <>
                      {recipient.contact?.phone ?? '-'}
                      {changed && (
                        <span
                          className="mt-0.5 flex items-center gap-1 text-xs text-amber-400"
                          title={t('numberChangedHint', {
                            phone: recipient.phone_attempted ?? '',
                          })}
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {t('triedNumber', {
                            phone: recipient.phone_attempted ?? '',
                          })}
                        </span>
                      )}
                    </>
                  );
                  const errorText = recipient.error_message?.trim();
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="max-w-[9rem] truncate font-medium text-foreground sm:max-w-xs">
                        {recipient.contact?.name ?? 'Unknown'}
                        <span className="mt-0.5 block whitespace-normal text-xs font-normal text-muted-foreground sm:hidden">
                          {phoneBlock}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {phoneBlock}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {tStatus(rStatus.label)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {attempts > 1 ? `×${attempts}` : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {stamps.length === 0
                          ? '-'
                          : stamps.map(({ label, value, tint }) => (
                              <div
                                key={label}
                                className={`whitespace-nowrap text-xs ${tint}`}
                              >
                                {/* Dimmed by opacity, not a muted colour,
                                    so the label stays the step's hue. */}
                                <span className="opacity-60">{label}</span>{' '}
                                {value}
                              </div>
                            ))}
                      </TableCell>
                      {/* Wraps instead of truncating: a clipped WhatsApp
                          error is unactionable, and `break-words` handles
                          the long unspaced codes Meta returns. Overrides
                          TableCell's default `whitespace-nowrap`. */}
                      <TableCell className="max-w-xs whitespace-normal break-words text-xs text-red-400">
                        {/* `|| '-'`, not `?? '-'`: an empty-string
                            error_message is as unhelpful as a null one
                            and used to render as a blank cell. */}
                        {recipient.error_message?.trim() || '-'}
                      </TableCell>
                      <TableCell>
                        {recipient.status === 'failed' && (
                          <GatedButton
                            canAct={canSend}
                            gateReason="send messages"
                            variant="outline"
                            size="sm"
                            disabled={
                              broadcast.status === 'sending' || retrying !== null
                            }
                            onClick={() => handleRetry(recipient.id)}
                            title={
                              changed
                                ? t('retryChangedNumber', {
                                    phone: recipient.contact?.phone ?? '',
                                  })
                                : t('retryRow')
                            }
                            className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted disabled:opacity-40"
                          >
                            <RotateCw
                              className={`h-3 w-3 ${
                                retrying === recipient.id ? 'animate-spin' : ''
                              }`}
                            />
                          </GatedButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
