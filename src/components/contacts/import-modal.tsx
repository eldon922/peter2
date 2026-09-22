'use client';

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import {
  parseContactCsv,
  type ParsedContactRow,
} from '@/lib/contacts/parse-contact-csv';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { planContactImport } from '@/lib/contacts/import-merge';
import { chunkIds, withRetry } from '@/lib/supabase/batching';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn(
        'block truncate',
        maxWidth,
        mono && 'font-mono text-[11px]'
      )}
      title={value}
    >
      {value}
    </span>
  );
}

function ImportPreviewTags({
  tagNames,
  tagColorByKey,
}: {
  tagNames: string[];
  tagColorByKey: Map<string, string>;
}) {
  const t = useTranslations('Contacts.importModal');

  if (tagNames.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const color =
          tagColorByKey.get(name.trim().toLowerCase()) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(name.trim().toLowerCase());
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
              color,
              border: `1px solid ${color}${isKnown ? '55' : '30'}`,
            }}
            title={isKnown ? name : t('willBeCreated', { name })}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedContactRow[]>([]);
  /**
   * In-file duplicates dropped at parse time, carried through to the
   * result summary so they're still reported as skipped. De-duping here
   * rather than at import time keeps the preview, the "rows ready" chip
   * and the Import button count all describing the same set of contacts —
   * they previously listed the raw CSV rows, so a file with the same
   * number twice showed (and offered to import) it twice.
   */
  const [inFileDuplicates, setInFileDuplicates] = useState(0);
  const [hasTagsColumn, setHasTagsColumn] = useState(false);
  const [hasCompanyColumn, setHasCompanyColumn] = useState(false);
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    /** Existing contacts the file added tags to and/or renamed. */
    updated: number;
    skipped: number;
    failed: number;
    tagsAssigned: number;
    /** True when this summary reflects a run that was cut short by an
     *  error partway through, not a normal completion. */
    partial: boolean;
  } | null>(null);
  /** Rows attempted so far vs. total, so a large import (which can be
   *  hundreds of sequential requests) doesn't look stalled or wrong
   *  while it's still working. */
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setInFileDuplicates(0);
    setHasTagsColumn(false);
    setHasCompanyColumn(false);
    setTagColorByKey(new Map());
    setResult(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const {
      rows,
      hasTagsColumn: csvHasTags,
      hasCompanyColumn: csvHasCompany,
    } = parseContactCsv(text);

    if (rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setParsedRows([]);
      setInFileDuplicates(0);
      setHasTagsColumn(false);
      setHasCompanyColumn(false);
      setTagColorByKey(new Map());
      return;
    }

    // Collapse repeats of the same number now, so everything downstream —
    // preview, counts, insert — works from one list.
    const { unique, duplicates } = dedupeByPhone(rows);
    setParsedRows(unique);
    setInFileDuplicates(duplicates);
    setHasTagsColumn(csvHasTags);
    setHasCompanyColumn(csvHasCompany);

    if (csvHasTags && accountId) {
      const { data: tags } = await supabase
        .from('tags')
        .select('name, color')
        .eq('account_id', accountId);

      const colors = new Map<string, string>();
      for (const tag of tags ?? []) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setTagColorByKey(new Map());
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setProgress(null);

    // Declared outside the try block on purpose: a large import is
    // dozens to hundreds of sequential requests, and if one fails
    // partway through, the catch block below still needs to report
    // what actually happened rather than lose it behind a generic
    // error toast — rows already written to the DB shouldn't vanish
    // from the summary just because a later request timed out.
    let imported = 0;
    // In-file duplicates were already collapsed at parse time; they
    // still count as skipped in the summary.
    let skipped = inFileDuplicates;
    let updated = 0;
    let failed = 0;
    let tagsAssigned = 0;
    let skippedNames: string[] = [];

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      const unique = parsedRows;

      // 1) Find which of these numbers this account already has, matched
      //    on the generated `phone_normalized` column (migration 022).
      //
      //    Looked up by the imported phones rather than by reading the
      //    whole contacts table: that read was unbounded and PostgREST
      //    caps a response at 1000 rows, so on a larger account it
      //    silently reported existing contacts as new. The cost is now
      //    proportional to the file, not to the account.
      const importedKeys = [
        ...new Set(unique.map((row) => normalizeKey(row.phone)).filter(Boolean)),
      ];
      const existingByPhone = new Map<
        string,
        { id: string; name: string | null }
      >();
      const lookupChunks = chunkIds(importedKeys);
      for (let i = 0; i < lookupChunks.length; i++) {
        const slice = lookupChunks[i];
        const { data: existingRows, error } = await withRetry(() =>
          supabase
            .from('contacts')
            .select('id, phone_normalized, name')
            .eq('account_id', accountId)
            .in('phone_normalized', slice)
        );
        // Unlike the writes below, a failed lookup isn't safe to just
        // shrug off: silently treating "couldn't check" as "not found"
        // would attempt to insert rows that already exist. Retried a
        // few times above; if it's still failing, stop and report what
        // happened rather than risk misclassifying the rest of the file.
        if (error) {
          throw new Error(
            `Couldn't look up existing contacts (batch ${i + 1} of ${lookupChunks.length}): ${error.message}`
          );
        }
        for (const r of (existingRows ?? []) as {
          id: string;
          phone_normalized: string | null;
          name: string | null;
        }[]) {
          if (r.phone_normalized) {
            existingByPhone.set(r.phone_normalized, { id: r.id, name: r.name });
          }
        }
      }

      // A number already on file is no longer dropped on the floor. The
      // row is treated as newer information about a contact we already
      // have — see planContactImport for the rules.
      const { toInsert, toMerge, duplicates } = planContactImport(
        unique,
        existingByPhone
      );
      skipped += duplicates;

      // 2) Resolve tag names → ids (admin+ may auto-create missing tags).
      //    Skip the round-trip when the import carries no tag names.
      //    Merge rows count here too: their tags are the whole point.
      const allTagNames = [
        ...toInsert.flatMap((row) => row.tagNames),
        ...toMerge.flatMap((m) => m.row.tagNames),
      ];
      let tagIdByKey = new Map<string, string>();
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await withRetry(() =>
          resolveImportTagIds(supabase, {
            accountId,
            userId: user.id,
            tagNames: allTagNames,
            canCreateTags: canEditSettings,
          })
        ));
      }

      const tagAssignments: ContactTagAssignment[] = [];

      // Total units of work across both phases, for the progress
      // indicator — otherwise a multi-thousand-row import just shows a
      // spinner for however long it takes, indistinguishable from
      // being stuck.
      const totalWork = toInsert.length + toMerge.length;
      let doneWork = 0;
      setProgress({ done: 0, total: totalWork });

      // 3) Batch insert the genuinely-new rows in chunks of 50. The DB
      //    unique index is the backstop: a 23505 (race, or a format
      //    that normalizes equal) counts as skipped, not failed.
      //    Each chunk (and each per-row fallback) is retried a few
      //    times on transient failures before giving up — see
      //    withRetry. This is safe to retry because a repeat of an
      //    already-succeeded insert just comes back as a 23505.
      const chunkSize = 50;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const rows = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        }));

        let data: { id: string }[] | null = null;
        let error: { message: string } | null = null;
        try {
          ({ data, error } = await withRetry(() =>
            supabase.from('contacts').insert(rows).select('id')
          ));
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
        }

        if (error) {
          // Retry individually so one bad/duplicate row doesn't sink
          // the whole chunk.
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const source = chunk[j];
            let singleData: { id: string } | null = null;
            let singleErr: unknown = null;
            try {
              ({ data: singleData, error: singleErr } = await withRetry(() =>
                supabase.from('contacts').insert(row).select('id').single()
              ));
            } catch (err) {
              singleErr = err;
            }

            if (!singleErr && singleData) {
              imported++;
              if (source.tagNames.length > 0) {
                tagAssignments.push({
                  contactId: singleData.id,
                  tagNames: source.tagNames,
                });
              }
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          // inserted[j] ↔ chunk[j] only holds because a single INSERT
          // preserves RETURNING order. If this path is ever split into
          // parallel inserts, zip by phone or returned id instead.
          for (let j = 0; j < inserted.length; j++) {
            const source = chunk[j];
            if (!source || source.tagNames.length === 0) continue;
            tagAssignments.push({
              contactId: inserted[j].id,
              tagNames: source.tagNames,
            });
          }
        }

        doneWork += chunk.length;
        setProgress({ done: doneWork, total: totalWork });
      }

      // 3b) Apply the merge rows. Tags go through the same assignment
      //     path as new contacts — it upserts with ignoreDuplicates, so a
      //     tag the contact already carries is a no-op rather than an
      //     error. Only the rename needs a write of its own.
      //
      //     Renames run a few at a time rather than all at once: this is
      //     one UPDATE per contact (PostgREST has no bulk update by id
      //     with differing values), and firing hundreds in parallel from
      //     the browser just queues them behind the connection limit.
      const RENAME_CONCURRENCY = 10;
      const renames = toMerge.filter((m) => m.rename !== null);
      const renameFailures = new Set<string>();

      for (let i = 0; i < renames.length; i += RENAME_CONCURRENCY) {
        const batch = renames.slice(i, i + RENAME_CONCURRENCY);
        const results = await Promise.all(
          batch.map((m) =>
            withRetry(() =>
              supabase
                .from('contacts')
                .update({ name: m.rename })
                .eq('id', m.id)
                .eq('account_id', accountId)
            ).catch((err) => ({
              error: err instanceof Error ? err : new Error(String(err)),
            }))
          )
        );
        for (let k = 0; k < results.length; k++) {
          if (results[k].error) {
            failed++;
            renameFailures.add(batch[k].id);
          }
        }
        doneWork += batch.length;
        setProgress({ done: doneWork, total: totalWork });
      }

      for (const m of toMerge) {
        if (m.row.tagNames.length > 0) {
          tagAssignments.push({ contactId: m.id, tagNames: m.row.tagNames });
        }
      }
      // Merge rows that only needed tags (no rename) never went through
      // the rename loop above, so progress hasn't counted them yet.
      doneWork += toMerge.length - renames.length;
      setProgress({ done: doneWork, total: totalWork });

      // Counted once per row touched, whether it was renamed, re-tagged
      // or both — the summary reports rows, not writes. A row whose only
      // contribution was a rename that failed is reported as failed, not
      // updated, so the two counts never describe the same row.
      updated = toMerge.filter(
        (m) => !(renameFailures.has(m.id) && m.row.tagNames.length === 0)
      ).length;

      // 4) Wire tags onto the contacts we just created. Failure here must
      //    not mask a successful contact import.
      try {
        tagsAssigned = await withRetry(() =>
          assignImportedContactTags(supabase, tagAssignments, tagIdByKey)
        );
      } catch {
        toast.warning(t('toastTagsWarning'));
      }

      setProgress(null);
      setResult({ imported, updated, skipped, failed, tagsAssigned, partial: false });
      if (imported > 0) {
        toast.success(t('toastImported', { count: imported }));
      }
      if (updated > 0) {
        toast.success(t('toastUpdated', { count: updated }));
      }
      // Either path changed contacts the list is showing, so refresh on
      // an update-only import too — otherwise merged tags and renames
      // stay invisible until a reload.
      if (imported > 0 || updated > 0) {
        onImported();
      }
      if (tagsAssigned > 0) {
        toast.success(t('toastTagsAssigned', { count: tagsAssigned }));
      }
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more =
          skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      if (skipped > 0) {
        toast.info(t('toastSkipped', { count: skipped }));
      }
      if (failed > 0) {
        toast.error(t('toastFailed', { count: failed }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toastError');
      toast.error(message);
      // Rows already written to the DB before the failure are real —
      // matching on phone means they won't be re-created on a retry,
      // so hiding them here would just make a partial import look like
      // a total failure. Show what happened and let the user re-run
      // the same file to pick up the rest.
      if (imported > 0 || updated > 0 || skipped > 0 || failed > 0) {
        setResult({
          imported,
          updated,
          skipped,
          failed,
          tagsAssigned,
          partial: true,
        });
      }
    } finally {
      setProgress(null);
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, PREVIEW_LIMIT);
  // Tags: OR — show when the CSV declares a column or preview rows carry
  // values, so an all-empty tags column still renders for validation.
  const previewHasTags =
    hasTagsColumn || preview.some((row) => row.tagNames.length > 0);
  // Company: AND — hide unless the CSV declares it and preview has data,
  // avoiding an all-dash column that wastes horizontal space.
  const previewHasCompany =
    hasCompanyColumn && preview.some((row) => row.company?.trim());

  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of parsedRows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [parsedRows]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              {t('title')}
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{
                __html: t.markup('desc', {
                  phoneCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  nameCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  emailCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  companyCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  tagsCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                })
              }}
            />
            {/* Says what happens to numbers already on file, because the
                answer changed: they used to be skipped. */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('mergeHint')}
            </p>
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: parsedRows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('uploadDropzone')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('uploadHint')}
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.length > 0 && !result && !importing && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('preview', { count: preview.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {inFileDuplicates > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-amber-500">
                      <AlertTriangle className="size-3" />
                      {t('previewDuplicates', { count: inFileDuplicates })}
                    </span>
                  )}
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', { tags: tagStats.unique, contacts: tagStats.rowsWithTags })}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.phone')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.name')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.email')}
                        </th>
                        {previewHasCompany && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.company')}
                          </th>
                        )}
                        {previewHasTags && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.tags')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="bg-popover/40 transition-colors hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            <PreviewCell
                              value={row.phone}
                              mono
                              maxWidth="max-w-[7.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-popover-foreground">
                            <PreviewCell
                              value={row.name || '—'}
                              maxWidth="max-w-[8.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <PreviewCell
                              value={row.email || '—'}
                              maxWidth="max-w-[10rem]"
                            />
                          </td>
                          {previewHasCompany && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell
                                value={row.company || '—'}
                                maxWidth="max-w-[7rem]"
                              />
                            </td>
                          )}
                          {previewHasTags && (
                            <td className="px-3 py-2 align-top">
                              <ImportPreviewTags
                                tagNames={row.tagNames}
                                tagColorByKey={tagColorByKey}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsedRows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', { count: parsedRows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {!result && importing && progress && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Loader2 className="text-primary size-5 animate-spin" />
              <p className="text-sm text-muted-foreground">
                {t('importingProgress', {
                  done: progress.done,
                  total: progress.total,
                })}
              </p>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">
                {result.partial ? t('importPartial') : t('importComplete')}
              </p>
              {result.partial && (
                <p className="mt-1 text-xs leading-relaxed text-amber-500">
                  {t('importPartialHint')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', { count: result.imported })}
                  </div>
                )}
                {result.updated > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultUpdated', { count: result.updated })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', { count: result.skipped })}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length > 0 ? t('importBtn', { count: parsedRows.length }) : t('importBtn', { count: 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
