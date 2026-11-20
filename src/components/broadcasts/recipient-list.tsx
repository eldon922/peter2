'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TagChips } from '@/components/broadcasts/tag-chips';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getRecipientStatus,
  recipientStatusConfig,
  statusTextClass,
} from '@/lib/broadcast-status';
import { numberChanged } from '@/lib/broadcasts/variables';
import { contactDisplayName } from '@/lib/contacts/display-name';
import type { BroadcastRecipient, Tag } from '@/types';

const STAMP_TINTS = {
  sent: statusTextClass(recipientStatusConfig.sent),
  delivered: statusTextClass(recipientStatusConfig.delivered),
  read: statusTextClass(recipientStatusConfig.read),
};

export function BroadcastRecipientList({
  recipients,
  tagsFor,
  includeTagIds,
  sending,
  retrying,
  canSend,
  onRetry,
}: {
  recipients: BroadcastRecipient[];
  tagsFor: (recipient: BroadcastRecipient) => Tag[];
  includeTagIds: string[];
  sending: boolean;
  retrying: string | null;
  canSend: boolean;
  onRetry: (recipientId: string) => void;
}) {
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const targetTagIds = new Set(includeTagIds);
  const entries = recipients.map((recipient) => {
    const status = getRecipientStatus(recipient.status);
    const failed = recipient.status === 'failed';
    const changed = numberChanged(recipient);
    const phone = recipient.contact?.phone ?? '—';
    const phoneBlock = (
      <>
        {phone}
        {changed && (
          <span
            className="mt-0.5 flex items-center gap-1 text-xs text-amber-400"
            title={t('numberChangedHint', {
              phone: recipient.phone_attempted ?? '',
            })}
          >
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
            {t('triedNumber', { phone: recipient.phone_attempted ?? '' })}
          </span>
        )}
      </>
    );
    const statusChip = (
      <span
        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
      >
        {tStatus(status.label)}
      </span>
    );
    const stamps = (
      [
        ['sent', recipient.sent_at],
        ['delivered', recipient.delivered_at],
        ['read', recipient.read_at],
      ] as const
    ).flatMap(([key, at]) =>
      at
        ? [
            {
              label: t(`table.${key}`),
              value: new Date(at).toLocaleString(),
              tint: STAMP_TINTS[key],
              at,
            },
          ]
        : []
    );
    const retryTitle = changed
      ? t('retryChangedNumber', { phone: recipient.contact?.phone ?? '' })
      : t('retryRow');

    function retryAction(mobile: boolean) {
      if (!failed) return null;
      return (
        <GatedButton
          canAct={canSend}
          gateReason="send messages"
          variant="outline"
          size="sm"
          disabled={sending || retrying !== null}
          onClick={() => onRetry(recipient.id)}
          title={retryTitle}
          aria-label={t('retryRow')}
          className={
            mobile
              ? 'min-h-10'
              : 'border-border text-muted-foreground hover:bg-muted h-7 bg-transparent disabled:opacity-40'
          }
        >
          <RotateCw
            className={`size-3 ${retrying === recipient.id ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {mobile && t('retryRow')}
        </GatedButton>
      );
    }

    return {
      id: recipient.id,
      name: recipient.contact
        ? contactDisplayName(recipient.contact)
        : tStatus('unknown'),
      tags: tagsFor(recipient).filter((tag) => targetTagIds.has(tag.id)),
      phoneBlock,
      statusChip,
      stamps,
      attempts: recipient.attempt_count ?? 1,
      error: recipient.error_message?.trim(),
      failed,
      retryAction,
    };
  });

  return (
    <>
      <ul className="space-y-3 p-3 @min-[50rem]:hidden" role="list">
        {entries.map(
          ({
            id,
            name,
            tags,
            phoneBlock,
            statusChip,
            stamps,
            attempts,
            error,
            failed,
            retryAction,
          }) => (
            <li
              key={id}
              className="border-border bg-background space-y-3 rounded-lg border p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold wrap-anywhere">{name}</h3>
                  <div className="text-muted-foreground text-xs wrap-anywhere">
                    {phoneBlock}
                  </div>
                </div>
                {statusChip}
              </div>
              <TagChips tags={tags} tone="include" />
              {(stamps.length > 0 || attempts > 1) && (
                <dl className="border-border text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-2 text-xs">
                  {stamps.map(({ label, value, tint, at }) => (
                    <div className="contents" key={label}>
                      <dt>{label}</dt>
                      <dd className={`text-right wrap-anywhere ${tint}`}>
                        <time dateTime={at}>{value}</time>
                      </dd>
                    </div>
                  ))}
                  {attempts > 1 && (
                    <>
                      <dt>{t('table.attempts')}</dt>
                      <dd className="text-foreground text-right tabular-nums">
                        {attempts}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {error && (
                <p className="text-xs wrap-anywhere text-red-300 in-data-[mode=light]:text-red-700">
                  {error}
                </p>
              )}
              {failed && (
                <div className="flex justify-end">{retryAction(true)}</div>
              )}
            </li>
          )
        )}
      </ul>
      <div className="hidden overflow-x-auto @min-[50rem]:block">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">
                {t('table.contact')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('table.phone')}
              </TableHead>
              {targetTagIds.size > 0 && (
                <TableHead className="text-muted-foreground">
                  {t('table.tags')}
                </TableHead>
              )}
              <TableHead className="text-muted-foreground">
                {t('table.status')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">
                <span className="inline-flex" title={t('table.attempts')}>
                  <RotateCw className="size-3.5" aria-hidden />
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
            {entries.map(
              ({
                id,
                name,
                tags,
                phoneBlock,
                statusChip,
                stamps,
                attempts,
                error,
                failed,
                retryAction,
              }) => (
                <TableRow key={id} className="border-border">
                  <TableCell className="text-foreground max-w-xs truncate font-medium">
                    {name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {phoneBlock}
                  </TableCell>
                  {targetTagIds.size > 0 && (
                    <TableCell className="max-w-64 whitespace-normal">
                      {tags.length ? (
                        <TagChips tags={tags} tone="include" />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {statusChip}
                    {error && (
                      <span className="mt-1 block max-w-56 text-xs wrap-anywhere whitespace-normal text-red-400 md:hidden">
                        {error}
                      </span>
                    )}
                    {!failed && stamps.length > 0 && (
                      <div className="mt-1 lg:hidden">
                        {stamps.map(({ label, value, tint }) => (
                          <div
                            key={label}
                            className={`text-xs whitespace-nowrap ${tint}`}
                          >
                            <span className="opacity-60">{label}</span> {value}
                          </div>
                        ))}
                      </div>
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
                            <span className="opacity-60">{label}</span> {value}
                          </div>
                        ))}
                  </TableCell>
                  <TableCell className="hidden max-w-xs text-xs wrap-anywhere whitespace-normal text-red-400 md:table-cell">
                    {error || '-'}
                  </TableCell>
                  <TableCell>{retryAction(false)}</TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
