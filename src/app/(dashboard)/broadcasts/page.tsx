'use client';

import { useEffect, useState, useMemo, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, Loader2 } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import {
  getBroadcastStatus,
  percentOfRecipients,
} from '@/lib/broadcast-status';
import { formatScheduledAt } from '@/lib/broadcasts/schedule';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { fetchAllRows } from '@/lib/supabase/batching';
import {
  BroadcastDuration,
  ScheduledCountdown,
} from '@/components/broadcasts/broadcast-timing';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percentOfRecipients(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
        {pct}%
      </span>
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.page');
  const tStatus = useTranslations('Broadcasts.status');
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
  function openBroadcast(id: string) {
    setOpeningId(id);
    startNavigation(() => router.push(`/broadcasts/${id}`));
  }
  const visibleBroadcasts = useMemo(
    () =>
      broadcasts.filter((broadcast) =>
        `${broadcast.name} ${broadcast.template_name} ${broadcast.template_language}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      ),
    [broadcasts, search]
  );

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { rows: data, error: fetchError } = await fetchAllRows<Broadcast>(
        (from, to) =>
          supabase.from('broadcasts').select('*').order('id').range(from, to)
      );

      if (fetchError) throw fetchError;
      setBroadcasts(
        data.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel('broadcast-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'broadcasts' },
        (event) => {
          if (event.eventType === 'DELETE')
            setBroadcasts((rows) =>
              rows.filter((row) => row.id !== event.old.id)
            );
          else {
            const next = event.new as Broadcast;
            setBroadcasts((rows) =>
              rows.some((row) => row.id === next.id)
                ? rows.map((row) => (row.id === next.id ? next : row))
                : [next, ...rows]
            );
          }
        }
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts]
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(
        fetchBroadcasts,
        anySending ? POLL_INTERVAL_MS : 15_000
      );
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Broadcast in progress"
          className="broadcast-indeterminate bg-muted fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden"
        >
          <div className="broadcast-indeterminate-bar bg-primary h-0.5" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create broadcasts"
          onClick={() => openBroadcast('new')}
          disabled={navigating}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {navigating && openingId === 'new' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t('newBroadcast')}
        </GatedButton>
      </div>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
      />
      {visibleBroadcasts.length === 0 ? (
        <div className="border-border bg-card flex h-64 flex-col items-center justify-center rounded-xl border">
          <Radio className="text-muted-foreground mb-3 h-10 w-10" />
          <p className="text-foreground text-sm font-medium">
            {t('noBroadcastsYet')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('createFirst')}
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="create broadcasts"
            onClick={() => openBroadcast('new')}
            disabled={navigating}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4"
          >
            <Plus className="h-4 w-4" />
            {t('newBroadcast')}
          </GatedButton>
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                {/* `w-full` hands this column all the space the others
                    don't claim. It matters most below sm, where Name and
                    Status are the only two columns left and the name
                    would otherwise sit in a narrow strip with the rest of
                    the row empty. `min-w-48` keeps it readable on a
                    narrow desktop, where Template is what gives way. */}
                <TableHead className="text-muted-foreground w-full min-w-48 md:w-[40%]">
                  {t('table.name')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden min-w-28 md:table-cell">
                  {t('table.template')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden text-right sm:table-cell">
                  {t('table.recipients')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.delivery')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.read')}
                </TableHead>
                <TableHead className="text-muted-foreground text-right sm:text-left">
                  {t('table.status')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden sm:table-cell">
                  {t('table.date')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBroadcasts.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                return (
                  <TableRow
                    key={broadcast.id}
                    className="border-border hover:bg-muted/50 cursor-pointer"
                    onClick={() => openBroadcast(broadcast.id)}
                    aria-busy={navigating && openingId === broadcast.id}
                  >
                    {/* Names are free text and routinely long enough to
                        set the table's width by themselves, which pushed
                        the whole row off a phone screen. Cap and ellipse
                        them; the full name is the page you land on. */}
                    {/* `w-full max-w-0` is the table-layout idiom for a
                        cell that takes the leftover width *and* still
                        truncates: without `max-w-0` the auto layout sizes
                        the column to the longest name and `truncate`
                        never engages. */}
                    <TableCell className="text-foreground w-full max-w-0 min-w-48 truncate font-medium md:w-[40%]">
                      {broadcast.name}
                      {navigating && openingId === broadcast.id && (
                        <Loader2 className="ml-2 inline size-3 animate-spin" />
                      )}
                      <BroadcastDuration broadcast={broadcast} />
                    </TableCell>
                    {/* `max-w-0` lets this column shrink and truncate
                        instead of claiming its full text width. */}
                    <TableCell className="text-muted-foreground hidden max-w-0 min-w-28 truncate md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                      {broadcast.total_recipients}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                        color="bg-primary"
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                        color="bg-blue-500"
                      />
                    </TableCell>
                    <TableCell className="text-right sm:text-left">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                      >
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          </span>
                        )}
                        {tStatus(status.label)}
                      </span>
                      {broadcast.status === 'scheduled' &&
                        broadcast.scheduled_at && (
                          <span className="text-muted-foreground mt-1 block text-xs whitespace-nowrap">
                            {formatScheduledAt(broadcast.scheduled_at)}
                          </span>
                        )}
                      <ScheduledCountdown broadcast={broadcast} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
