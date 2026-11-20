'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { useCan } from '@/hooks/use-can';
import { numberChanged } from '@/lib/broadcasts/variables';
import {
  headerMediaError,
  NO_HEADER_MEDIA,
  type HeaderMedia,
} from '@/lib/broadcasts/header-media';
import { isHeaderMediaKind, type HeaderMediaKind } from '@/lib/media-specs';
import { HeaderMediaPicker } from '@/components/broadcasts/header-media-picker';
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
  Link,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  RotateCw,
  AlertTriangle,
  ImageIcon,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
  recipientStatusConfig,
  statusTextClass,
} from '@/lib/broadcast-status';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { TagChips } from '@/components/broadcasts/tag-chips';
import { UnsentBanner } from '@/components/broadcasts/unsent-banner';
import { contactDisplayName } from '@/lib/contacts/display-name';
import { fetchBroadcastRecipients } from '@/lib/broadcasts/recipients';
import { SendConfirmationDialog } from '@/components/broadcasts/send-confirmation-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SearchInput } from '@/components/ui/search-input';
import { ListPagination, useListPage } from '@/components/ui/list-pagination';
import { broadcastRunProgress } from '@/lib/broadcasts/run-progress';
import { BroadcastDuration } from '@/components/broadcasts/broadcast-timing';
import { fetchAllRows } from '@/lib/supabase/batching';
import { cn } from '@/lib/utils';

interface StatCardProps {
  basis: string;
  label: string;
  hint?: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({
  secondary,
  className,
  ...metric
}: StatCardProps & { secondary?: StatCardProps; className?: string }) {
  return (
    <div
      className={cn(
        'border-border bg-card grid rounded-xl border',
        secondary && 'divide-border grid-cols-2 divide-x',
        className
      )}
    >
      <StatMetric {...metric} />
      {secondary && <StatMetric {...secondary} />}
    </div>
  );
}

function StatMetric({
  label,
  hint,
  value,
  total,
  icon,
  color,
  basis,
}: StatCardProps) {
  const ratio = total ? value / total : 0;
  const format = useFormatter();
  const hintId = useId();
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span
            aria-hidden
            className={`grid size-8 shrink-0 place-items-center rounded-lg ${color}`}
          >
            {icon}
          </span>
          {hint ? (
            <TooltipProvider>
              <Tooltip open={hintOpen} onOpenChange={setHintOpen}>
                <TooltipTrigger
                  closeOnClick={false}
                  onClick={() => setHintOpen(true)}
                  aria-describedby={hintOpen ? hintId : undefined}
                  className="focus-visible:ring-ring rounded-sm text-left underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2"
                >
                  {label}
                </TooltipTrigger>
                <TooltipContent id={hintId} role="tooltip">
                  {hint}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            label
          )}
        </div>
        <span
          className={`text-xl font-bold tabular-nums ${color.split(' ').at(-1)}`}
        >
          {format.number(ratio, { style: 'percent', maximumFractionDigits: 1 })}
        </span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-foreground text-2xl font-bold tabular-nums">
          {format.number(value)}
        </span>
        <span className="text-muted-foreground text-xs">{basis}</span>
      </p>
      <div
        aria-hidden
        className="bg-muted mt-auto h-2 overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full bg-current ${color.split(' ').at(-1)}`}
          style={{ width: `${Math.min(100, 100 * ratio)}%` }}
        />
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

// Delivery and reply receipts keep arriving after sending finishes.
const IDLE_POLL_INTERVAL_MS = 30000;

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const locale = useLocale();
  // Shared with the wizard's personalize step — same upload/URL
  // strings, same recommendation, so a retry prompt doesn't teach the
  // user a second vocabulary for the same choice.
  const broadcastId = params.id as string;
  const canSend = useCan('send-messages');

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recipientSearch, setRecipientSearch] = useState('');
  const deferredRecipientSearch = useDeferredValue(recipientSearch);
  const [filtering, startFiltering] = useTransition();
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all'
  );
  const [recipientCount, setRecipientCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const { page: recipientPage, setPage: setRecipientPage } = useListPage(
    recipientCount,
    50,
    `${statusFilter}:${deferredRecipientSearch}`
  );
  const refreshSequence = useRef(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags]
  );
  /** Broadcast id while a bulk retry is in flight, or a recipient id for a row retry. */
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryConfirmation, setRetryConfirmation] = useState<{
    recipientId?: string;
  } | null>(null);
  /**
   * Set when the server refused a retry because it can't tell which
   * media this broadcast sent. Holds the pending retry's scope so
   * answering the prompt resumes exactly what was clicked.
   */
  const [mediaPrompt, setMediaPrompt] = useState<{
    recipientId?: string;
    media: HeaderMedia;
    /** The server's explanation, shown as the dialog description. */
    error: string;
    headerType: HeaderMediaKind;
  } | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoadingRecipients(true);
    try {
      const supabase = createClient();
      const [broadcastResult, recipientResult] = await Promise.all([
        supabase.from('broadcasts').select('*').eq('id', broadcastId).single(),
        supabase.rpc('broadcast_recipient_page', {
          p_broadcast_id: broadcastId,
          p_status: statusFilter,
          p_search: deferredRecipientSearch,
          p_limit: 50,
          p_offset: recipientPage * 50,
        }),
      ]);
      if (sequence !== refreshSequence.current) return;
      if (broadcastResult.error) throw broadcastResult.error;
      if (recipientResult.error) throw recipientResult.error;
      setBroadcast(broadcastResult.data);
      setRecipients(recipientResult.data.rows as BroadcastRecipient[]);
      setRecipientCount(Number(recipientResult.data.total));
      setError(null);
    } catch (err) {
      if (sequence === refreshSequence.current)
        setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      if (sequence === refreshSequence.current) {
        setLoading(false);
        setLoadingRecipients(false);
      }
    }
  }, [broadcastId, statusFilter, deferredRecipientSearch, recipientPage, t]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current++;
    };
  }, [refresh]);

  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel(`broadcast-detail:${broadcastId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'broadcasts',
          filter: `id=eq.${broadcastId}`,
        },
        (event) => setBroadcast(event.new as Broadcast)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'broadcast_recipients',
          filter: `broadcast_id=eq.${broadcastId}`,
        },
        (event) => {
          const next = event.new as BroadcastRecipient;
          setRecipients((rows) =>
            rows.map((row) => (row.id === next.id ? { ...row, ...next } : row))
          );
        }
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [broadcastId]);

  useEffect(() => {
    const db = createClient();
    void fetchAllRows<Tag>((from, to) =>
      db.from('tags').select('*').order('id').range(from, to)
    ).then(({ rows }) => setTags(rows));
  }, []);

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
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        // Catch up immediately on the way back, then resume the timer —
        // otherwise a tab hidden for an hour shows an hour-old funnel
        // for up to another full interval.
        refresh();
        startPolling();
      }
    }

    if (document.visibilityState === 'visible') {
      startPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // Re-runs when the send finishes: the cleanup tears down the 5s timer
    // and the next pass starts a 30s one.
  }, [isSending, refresh]);

  const filteredRecipients = recipients.filter(
    (recipient) => statusFilter === 'all' || recipient.status === statusFilter
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
          // A media id (upload path) takes priority over a URL.
          ...(mediaPrompt?.media.mediaId.trim()
            ? { header_media_id: mediaPrompt.media.mediaId.trim() }
            : mediaPrompt?.media.url.trim()
              ? { header_media_url: mediaPrompt.media.url.trim() }
              : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The server refuses rather than guessing whenever it can't
        // reproduce the original message. Two of those refusals are
        // answerable by the user, so ask instead of just reporting.
        if (
          data.code === 'header_media_required' ||
          data.code === 'header_media_expired'
        ) {
          setMediaPrompt({
            recipientId,
            media: NO_HEADER_MEDIA,
            error: data.error,
            headerType: isHeaderMediaKind(data.headerType)
              ? data.headerType
              : 'image',
          });
          return;
        }
        toast.error(
          data.code === 'params_unrecoverable'
            ? t('toastRetryUnrecoverable')
            : data.code === 'template_missing'
              ? t('toastRetryTemplateMissing')
              : t('toastRetryFailed', { error: data.error ?? 'Unknown error' })
        );
        return;
      }

      setMediaPrompt(null);

      if (data.retrying === 0) {
        toast.info(t('noFailedToRetry'));
      } else if (data.remaining > 0) {
        toast.success(
          t('toastRetryPartial', {
            count: data.retrying,
            remaining: data.remaining,
          })
        );
      } else {
        toast.success(t('toastRetryStarted', { count: data.retrying }));
      }
      await refresh();
    } catch (err) {
      toast.error(
        t('toastRetryFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    } finally {
      setRetrying(null);
    }
  }

  async function handleStop() {
    setStopping(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/stop`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          t('toastStopFailed', { error: data.error ?? 'Unknown error' })
        );
        return;
      }
      toast.success(t('toastStopped'));
      await refresh();
    } catch (err) {
      toast.error(
        t('toastStopFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    } finally {
      setStopping(false);
    }
  }

  function recipientTags(recipient: BroadcastRecipient): Tag[] {
    return (recipient.contact?.contact_tags ?? []).flatMap(({ tag_id }) => {
      const tag = tagsById.get(tag_id);
      return tag ? [tag] : [];
    });
  }

  async function handleExport() {
    if (!broadcast) return;
    if (exporting) return;
    setExporting(true);
    try {
      const allRecipients = await fetchBroadcastRecipients(
        createClient(),
        broadcastId,
        true
      );
      const header = [
        t('table.contact'),
        t('table.phone'),
        t('table.tags'),
        t('table.phoneAttempted'),
        t('table.status'),
        t('table.attempts'),
        t('table.sent'),
        t('table.delivered'),
        t('table.read'),
        t('table.error'),
      ];
      const rows = allRecipients.map((r) => [
        r.contact?.name ?? '',
        r.contact?.phone ?? '',
        recipientTags(r)
          .map((tag) => tag.name)
          .join('; '),
        r.phone_attempted ?? '',
        r.status,
        String(r.attempt_count ?? 1),
        r.sent_at ?? '',
        r.delivered_at ?? '',
        r.read_at ?? '',
        r.error_message ?? '',
      ]);
      const csv = toCsv([header, ...rows]);
      const safeName = broadcast.name
        .replace(/[^a-z0-9-_]+/gi, '-')
        .toLowerCase();
      downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setExporting(false);
    }
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
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
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
  const audienceFilter = (broadcast.audience_filter ?? {}) as {
    type?: string;
    tagIds?: string[];
    excludeTagIds?: string[];
  };
  const targetTags = tags.filter((tag) =>
    audienceFilter.tagIds?.includes(tag.id)
  );
  const excludedTags = tags.filter((tag) =>
    audienceFilter.excludeTagIds?.includes(tag.id)
  );
  const targetLabel =
    audienceFilter.type === 'custom_field'
      ? t('targetCustomField')
      : audienceFilter.type === 'csv'
        ? t('targetCsv')
        : t('targetAll');
  const statusChipClass = `items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`;
  const ofAudience = t('stats.ofAudience', {
    count: broadcast.total_recipients,
  });
  const ofSent = t('stats.ofSent', { count: broadcast.sent_count });
  // The database leaves this null unless the broadcast used a tracked button.
  const clicks = broadcast.link_click_count;

  const {
    total: progressTotal,
    done: progressDone,
    percent: sendProgress,
  } = broadcastRunProgress(broadcast);

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
            <h1 className="text-foreground text-2xl font-bold break-words">
              {broadcast.name}
            </h1>
          </div>
        </div>

        {/* The status chip lives with the actions at every width — one
            row holding "what state is this in" and "what can I do about
            it". `w-full` below md guarantees that row is its own line
            (with the chip at its left end) instead of wrapping
            unpredictably; from md up it shrinks to sit beside the title. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-2 md:w-auto md:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex shrink-0 ${statusChipClass}`}>
              {tStatus(status.label)}
            </span>
            <time
              className="text-muted-foreground text-xs whitespace-nowrap"
              dateTime={broadcast.created_at}
            >
              {t('createdAt', {
                date: new Date(broadcast.created_at).toLocaleDateString(locale, {
                  dateStyle: 'medium',
                }),
              })}
            </time>
          </div>

          <div className="flex items-center gap-2">
            {/* Stop — unsent recipients become failed, so Retry resumes them. */}
            {broadcast.status === 'sending' && (
              <GatedButton
                canAct={canSend}
                gateReason="stop broadcasts"
                variant="outline"
                size="sm"
                disabled={stopping}
                onClick={handleStop}
                title={t('stopHover')}
                className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
              >
                {stopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {stopping ? t('stopping') : t('stop')}
              </GatedButton>
            )}
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
                onClick={() => setRetryConfirmation({})}
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
                  className="border-border text-muted-foreground hover:bg-muted h-7 bg-transparent"
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
              <GatedButton
                canAct={canSend}
                gateReason="delete broadcasts"
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
              </GatedButton>
            )}
          </div>
        </div>
      </div>

      {/* A draft only has something to start once it holds recipients (a
          cancelled schedule); the old "Save as Draft" ones hold none. */}
      {(broadcast.status === 'scheduled' ||
        (broadcast.status === 'draft' && broadcast.total_recipients > 0)) && (
        <UnsentBanner
          broadcast={broadcast}
          canSend={canSend}
          onChange={refresh}
        />
      )}

      {/* Sending progress — shown whenever the fan-out is actually
          running server-side, whether that's the wizard's initial send
          (just navigated here) or a retry kicked off from the button
          above. Same visual shape as the wizard's own processing
          overlay (Step4ScheduleSend), driven by polling instead of a
          client-side counter. */}
      {broadcast.status === 'sending' && (
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <p className="text-foreground text-sm font-medium">
                {t('sendingProgress')}
              </p>
            </div>
            <span className="text-primary text-xs font-medium">
              {sendProgress}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${sendProgress}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {t('sendingCounts', {
              done: progressDone,
              total: progressTotal,
              remaining: Math.max(0, progressTotal - progressDone),
            })}
          </p>
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
                <p className="text-muted-foreground mt-1 text-xs">
                  {mediaPrompt.error}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="text-primary h-4 w-4" />
                  <label className="text-muted-foreground text-xs font-medium">
                    {t('mediaPromptLabel')}
                  </label>
                  <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase">
                    {mediaPrompt.headerType}
                  </span>
                </div>

                <HeaderMediaPicker
                  kind={mediaPrompt.headerType}
                  value={mediaPrompt.media}
                  onChange={(media) =>
                    setMediaPrompt({ ...mediaPrompt, media })
                  }
                  onSubmit={() => handleRetry(mediaPrompt.recipientId)}
                />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={
                      headerMediaError(mediaPrompt.media) !== null ||
                      retrying !== null
                    }
                    onClick={() => handleRetry(mediaPrompt.recipientId)}
                    className="bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {retrying !== null
                      ? t('retrying')
                      : t('mediaPromptConfirm')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retrying !== null}
                    onClick={() => setMediaPrompt(null)}
                    className="border-border text-muted-foreground hover:bg-muted bg-transparent"
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </div>

              <p className="text-muted-foreground text-xs">
                {t('mediaPromptHint')}
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="@container space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users className="text-muted-foreground size-4" aria-hidden />
            {t('stats.overview')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t('stats.audienceBasis', { count: broadcast.total_recipients })}
          </span>
        </div>
        <div className="grid gap-3 @min-[36rem]:grid-cols-3">
          <StatCard
            label={t('stats.totalRecipients')}
            basis={t('stats.base')}
            value={broadcast.total_recipients}
            total={broadcast.total_recipients}
            icon={<Users className="h-4 w-4" />}
            color="bg-muted text-muted-foreground"
          />
          <StatCard
            label={t('stats.sent')}
            basis={ofAudience}
            value={broadcast.sent_count}
            total={broadcast.total_recipients}
            icon={<Send className="h-4 w-4" />}
            color="bg-primary/10 text-primary"
          />
          <StatCard
            label={t('stats.failed')}
            basis={ofAudience}
            value={broadcast.failed_count}
            total={broadcast.total_recipients}
            icon={<AlertCircle className="h-4 w-4" />}
            color="bg-red-500/10 text-red-400"
          />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <MessageCircle
              className="text-muted-foreground size-4"
              aria-hidden
            />
            {t('stats.performance')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t('stats.sentBasis', { count: broadcast.sent_count })}
          </span>
        </div>
        <div
          className={cn(
            'grid gap-3',
            clicks == null
              ? '@min-[36rem]:grid-cols-3'
              : '@min-[31rem]:grid-cols-2 @min-[60rem]:grid-cols-4'
          )}
        >
          <StatCard
            label={t('stats.delivered')}
            basis={ofSent}
            value={broadcast.delivered_count}
            total={broadcast.sent_count}
            icon={<CheckCheck className="h-4 w-4" />}
            color="bg-green-500/10 text-green-400"
          />
          <StatCard
            label={t('stats.read')}
            basis={ofSent}
            value={broadcast.read_count}
            total={broadcast.sent_count}
            icon={<Eye className="h-4 w-4" />}
            color="bg-blue-500/10 text-blue-400"
          />
          <StatCard
            label={t('stats.replied')}
            basis={ofSent}
            hint={t('stats.repliedHint')}
            value={broadcast.replied_count}
            total={broadcast.sent_count}
            icon={<MessageCircle className="h-4 w-4" />}
            color="bg-indigo-500/10 text-indigo-400"
            className={clicks != null ? '@min-[31rem]:col-span-2' : undefined}
            secondary={
              clicks == null
                ? undefined
                : {
                    label: t('stats.clickRate'),
                    basis: ofSent,
                    value: clicks,
                    total: broadcast.sent_count,
                    icon: <Link className="size-4" />,
                    color: 'bg-violet-500/10 text-violet-400',
                  }
            }
          />
        </div>
      </section>
      {/* Recipients Table */}
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {broadcast.started_at && (
          <>
            <BroadcastDuration broadcast={broadcast} />
            <span aria-hidden>·</span>
          </>
        )}
        <span>{t('template', { name: broadcast.template_name })}</span>
        <span aria-hidden>·</span>
        <span>
          {t('targetRecipients', { count: broadcast.total_recipients })}
        </span>
        <span aria-hidden>·</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {t('target')}:
          {targetTags.length > 0 ? (
            <TagChips tags={targetTags} tone="include" />
          ) : (
            <span>{targetLabel}</span>
          )}
          {excludedTags.length > 0 && (
            <>
              <span>{t('targetExcluding')}</span>
              <TagChips tags={excludedTags} tone="exclude" />
            </>
          )}
        </div>
      </div>
      <SendConfirmationDialog
        open={retryConfirmation !== null}
        onOpenChange={(open) => {
          if (!open) setRetryConfirmation(null);
        }}
        broadcast={broadcast}
        recipientId={retryConfirmation?.recipientId}
        retry
        busy={retrying !== null}
        title={t('retryHover')}
        confirmLabel={t('retryRow')}
        onConfirm={() => {
          const target = retryConfirmation?.recipientId;
          setRetryConfirmation(null);
          void handleRetry(target);
        }}
      />
      <div
        className="border-border bg-card @container rounded-xl border"
        aria-busy={
          loadingRecipients ||
          filtering ||
          recipientSearch !== deferredRecipientSearch
        }
      >
        <div className="border-border flex flex-col gap-3 border-b p-4 @min-[50rem]:flex-row @min-[50rem]:items-center">
          <h2 className="text-foreground text-sm font-semibold whitespace-nowrap">
            {statusFilter !== 'all' || deferredRecipientSearch.trim()
              ? t('recipientsHeader', {
                  filtered: recipientCount,
                  total: broadcast.total_recipients,
                })
              : t('recipientsHeaderAll', { total: broadcast.total_recipients })}
          </h2>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 @min-[50rem]:flex-1 @min-[50rem]:flex-nowrap">
            <div className="relative w-full min-w-0 @min-[50rem]:w-auto @min-[50rem]:max-w-100 @min-[50rem]:flex-1">
              <SearchInput
                value={recipientSearch}
                onClear={() => setRecipientSearch('')}
                loading={
                  loadingRecipients ||
                  filtering ||
                  recipientSearch !== deferredRecipientSearch
                }
                onChange={(event) => setRecipientSearch(event.target.value)}
                placeholder={t('searchRecipients')}
                aria-label={t('searchRecipients')}
                className="bg-background h-10 w-full pr-9 pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-3 whitespace-nowrap"
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
                  onClick={() => startFiltering(() => setStatusFilter('all'))}
                  className={
                    statusFilter === 'all'
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => startFiltering(() => setStatusFilter(s))}
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
              disabled={exporting || broadcast.total_recipients === 0}
              className="h-10 px-3 whitespace-nowrap"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {t('exportCsv')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              {broadcast.total_recipients === 0
                ? t('noRecipients')
                : t('noRecipientsFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  {/* Seven columns do not fit a phone. Rather than leave
                      it all to horizontal scroll, secondary columns drop
                      out on the same breakpoint ladder the broadcasts
                      list uses — and the two that carry information you
                      can't act without, the number dialled and the
                      failure reason, reappear stacked inside the cells
                      that stay. */}
                  <TableHead className="text-muted-foreground">
                    {t('table.contact')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden sm:table-cell">
                    {t('table.phone')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">
                    {t('table.tags')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('table.status')}
                  </TableHead>
                  {/* Cells here only ever hold "×2", so the word
                      "Attempts" was setting this column's width by
                      itself. Icon + tooltip keeps it narrow. */}
                  <TableHead className="text-muted-foreground hidden lg:table-cell">
                    <span className="inline-flex" title={t('table.attempts')}>
                      <RotateCw className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">{t('table.attempts')}</span>
                    </span>
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden lg:table-cell">
                    {t('table.timestamps')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">
                    {t('table.error')}
                  </TableHead>
                  <TableHead className="text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  const contactTags = recipientTags(recipient);
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
                      ? [
                          {
                            label,
                            tint,
                            value: new Date(at).toLocaleString(),
                          },
                        ]
                      : []
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
                      <TableCell className="text-foreground max-w-[9rem] truncate font-medium sm:max-w-xs">
                        {recipient.contact
                          ? contactDisplayName(recipient.contact)
                          : 'Unknown'}
                        <span className="text-muted-foreground mt-0.5 block text-xs font-normal whitespace-normal sm:hidden">
                          {phoneBlock}
                        </span>
                        {contactTags.length > 0 && (
                          <div className="mt-1 whitespace-normal md:hidden">
                            <TagChips tags={contactTags} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {phoneBlock}
                      </TableCell>
                      <TableCell className="hidden max-w-64 whitespace-normal md:table-cell">
                        {contactTags.length ? (
                          <TagChips tags={contactTags} />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {tStatus(rStatus.label)}
                        </span>
                        {/* The error column is hidden below md, and
                            "Failed" with no reason is not actionable. */}
                        {errorText && (
                          <span className="mt-1 block max-w-[14rem] text-xs break-words whitespace-normal text-red-400 md:hidden">
                            {errorText}
                          </span>
                        )}
                        {/* Timestamps get their own column only at lg, so
                            restate them here below that. Failed rows are
                            excluded: the row never reached a step worth
                            timing, and the error above is what you act
                            on — so the two never stack up together. */}
                        {recipient.status !== 'failed' && stamps.length > 0 && (
                          <span className="mt-1 block lg:hidden">
                            {stamps.map(({ label, value, tint }) => (
                              <span
                                key={label}
                                className={`block text-xs whitespace-nowrap ${tint}`}
                              >
                                <span className="opacity-60">{label}</span>{' '}
                                {value}
                              </span>
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden lg:table-cell">
                        {attempts > 1 ? `×${attempts}` : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden lg:table-cell">
                        {stamps.length === 0
                          ? '-'
                          : stamps.map(({ label, value, tint }) => (
                              <div
                                key={label}
                                className={`text-xs whitespace-nowrap ${tint}`}
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
                      <TableCell className="hidden max-w-xs text-xs break-words whitespace-normal text-red-400 md:table-cell">
                        {/* `|| '-'`, not `?? '-'`: an empty-string
                            error_message is as unhelpful as a null one
                            and used to render as a blank cell. */}
                        {errorText || '-'}
                      </TableCell>
                      <TableCell>
                        {recipient.status === 'failed' && (
                          <GatedButton
                            canAct={canSend}
                            gateReason="send messages"
                            variant="outline"
                            size="sm"
                            disabled={
                              broadcast.status === 'sending' ||
                              retrying !== null
                            }
                            onClick={() =>
                              setRetryConfirmation({
                                recipientId: recipient.id,
                              })
                            }
                            title={
                              changed
                                ? t('retryChangedNumber', {
                                    phone: recipient.contact?.phone ?? '',
                                  })
                                : t('retryRow')
                            }
                            className="border-border text-muted-foreground hover:bg-muted h-7 bg-transparent disabled:opacity-40"
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
        <ListPagination
          page={recipientPage}
          pageSize={50}
          total={recipientCount}
          onPageChange={setRecipientPage}
          busy={loadingRecipients}
        />
      </div>
    </div>
  );
}
