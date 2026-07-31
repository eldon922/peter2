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
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
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
  color: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 */
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Funnel</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 rounded-full bg-muted">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-foreground">
                  {step.value.toLocaleString()}
                  <span className="ml-2 text-muted-foreground/80">
                    ({pctOfSent}%)
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

/** Matches the broadcasts list page, which polls on the same signal. */
const POLL_INTERVAL_MS = 5000;

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

  // Poll while a send or retry is fanning out so the funnel and the
  // recipient rows advance live. Same pattern (and interval) as the
  // list page, including pausing while the tab is hidden.
  const isSending = broadcast?.status === 'sending';
  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(refresh, POLL_INTERVAL_MS);
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

  const funnelSteps: FunnelStep[] = [
    { label: t('stats.sent'), value: broadcast.sent_count, color: 'bg-primary' },
    { label: t('stats.delivered'), value: broadcast.delivered_count, color: 'bg-teal-500' },
    { label: t('stats.read'), value: broadcast.read_count, color: 'bg-blue-500' },
    { label: t('stats.replied'), value: broadcast.replied_count, color: 'bg-indigo-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{broadcast.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {tStatus(status.label)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{t('template', { name: broadcast.template_name })}</span>
              <span>-</span>
              <span>
                {t('createdAt', { date: new Date(broadcast.created_at).toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>

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
          color="bg-teal-500/10 text-teal-400"
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

      <FunnelChart steps={funnelSteps} />

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
                  <TableHead className="text-muted-foreground">{t('table.attempts')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.sent')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.delivered')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.read')}</TableHead>
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
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="font-medium text-foreground">
                        {recipient.contact?.name ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
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
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.error_message ?? '-'}
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
