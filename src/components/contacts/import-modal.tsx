'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Tag as TagRecord, CustomField } from '@/types';
import { Input } from '@/components/ui/input';
import { TagMultiSelect } from '@/components/ui/tag-multi-select';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
  phoneLookupKeys,
} from '@/lib/contacts/dedupe';
import {
  parseContactCsv,
  parseTagCell,
  type ParsedContactRow,
} from '@/lib/contacts/parse-contact-csv';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { saveImportedCustomValues } from '@/lib/contacts/import-custom-values';
import { planContactImport } from '@/lib/contacts/import-merge';
import {
  emptyReport,
  type ImportReport,
  type ReportRow,
} from '@/lib/contacts/import-report';
import { ImportReportDetails } from '@/components/contacts/import-report-details';
import {
  chunkIds,
  fetchAllRows,
  INSERT_BATCH_SIZE,
  withRetry,
} from '@/lib/supabase/batching';
import { cn } from '@/lib/utils';
import { prepareContactPhones } from '@/lib/contacts/prepare-phones';
import { toMetaPhone } from '@/lib/whatsapp/phone-utils';
import { fetchDefaultCountryCode } from '@/lib/whatsapp/phone-format';
import { PhoneCountryWarning } from '@/components/phone-country-warning';
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
  ChevronDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;

const csvColumn = (chunks: ReactNode) => (
  <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
    {chunks}
  </code>
);

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
      className={cn('block truncate', maxWidth, mono && 'font-mono text-xs')}
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
            className="text-foreground inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
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
  const fileRequest = useRef(0);
  const [parsingFile, setParsingFile] = useState(false);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [csvCustomFieldIds, setCsvCustomFieldIds] = useState<string[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedContactRow[]>([]);
  const [availableTags, setAvailableTags] = useState<TagRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [extraTags, setExtraTags] = useState('');
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    fetchAllRows<TagRecord>((from, to) =>
      supabase
        .from('tags')
        .select('*')
        .eq('account_id', accountId)
        .order('name')
        .order('id')
        .range(from, to)
    ).then(({ rows, error }) => {
      if (cancelled) return;
      if (error) {
        toast.error(t('toastError'));
        return;
      }
      setAvailableTags(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase, t]);
  const importRows = useMemo(() => {
    const added = [
      ...availableTags
        .filter((tag) => selectedTagIds.includes(tag.id))
        .map((tag) => tag.name),
      ...parseTagCell(extraTags),
    ];
    return parsedRows.map((row) => ({
      ...row,
      tagNames: parseTagCell([...row.tagNames, ...added].join(';')),
    }));
  }, [parsedRows, selectedTagIds, availableTags, extraTags]);
  /**
   * In-file duplicates dropped at parse time, carried through to the
   * result summary so they're still reported as skipped. De-duping here
   * rather than at import time keeps the preview, the "rows ready" chip
   * and the Import button count all describing the same set of contacts —
   * they previously listed the raw CSV rows, so a file with the same
   * number twice showed (and offered to import) it twice.
   */
  const [inFileDropped, setInFileDropped] = useState<ReportRow[]>([]);
  const [hasTagsColumn, setHasTagsColumn] = useState(false);
  const [hasCompanyColumn, setHasCompanyColumn] = useState(false);
  const tagColorByKey = useMemo(
    () =>
      new Map(
        availableTags.map((tag) => [tag.name.trim().toLowerCase(), tag.color])
      ),
    [availableTags]
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    /** Row-by-row outcome. `updated` = existing contacts the file added
     *  tags to and/or renamed. */
    report: ImportReport;
    tagsAssigned: number;
    /** True when this summary reflects a run that was cut short by an
     *  error partway through, not a normal completion. */
    partial: boolean;
  } | null>(null);
  /** Rows attempted so far vs. total, so a large import (which can be
   *  hundreds of sequential requests) doesn't look stalled or wrong
   *  while it's still working. `total` is absent for steps that are a
   *  single request. */
  const [progress, setProgress] = useState<{
    stage: 'checking' | 'tags' | 'adding' | 'updating' | 'linking' | 'fields';
    done: number;
    total?: number;
  } | null>(null);

  function reset() {
    setCountryCode(null);
    fileRequest.current++;
    setParsingFile(false);
    setCsvCustomFieldIds([]);
    setFile(null);
    setParsedRows([]);
    setSelectedTagIds([]);
    setExtraTags('');
    setInFileDropped([]);
    setHasTagsColumn(false);
    setHasCompanyColumn(false);
    setResult(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next && importing) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function loadFile(selected: File) {
    if (importing || !accountId) return;
    const request = ++fileRequest.current;
    setFile(selected);
    setResult(null);
    setParsedRows([]);
    setCsvCustomFieldIds([]);
    setParsingFile(true);
    try {
      const [text, fields, code] = await Promise.all([
        selected.text(),
        fetchAllRows<CustomField>((from, to) =>
          supabase
            .from('custom_fields')
            .select('*')
            .eq('account_id', accountId)
            .order('id')
            .range(from, to)
        ),
        fetchDefaultCountryCode(),
      ]);
      if (request !== fileRequest.current) return;
      if (fields.error) throw fields.error;
      const {
        rows,
        hasTagsColumn: csvHasTags,
        hasCompanyColumn: csvHasCompany,
        customFieldIds = [],
      } = parseContactCsv(text, fields.rows, code);
      setCountryCode(code);
      setCustomFields(fields.rows);
      setCsvCustomFieldIds(customFieldIds);

      if (rows.length === 0) {
        toast.error(t('toastNoValidRows'));
        setParsedRows([]);
        setInFileDropped([]);
        setHasTagsColumn(false);
        setHasCompanyColumn(false);
        return;
      }

      // Collapse repeats of the same number now, so everything downstream —
      // preview, counts, insert — works from one list.
      // A repeated number still contributes its tags (and any blank fields).
      const { unique, dropped } = dedupeByPhone(
        rows,
        (kept, repeat) => {
          const known = new Set(kept.tagNames.map((n) => n.toLowerCase()));
          for (const name of repeat.tagNames) {
            if (!known.has(name.toLowerCase())) kept.tagNames.push(name);
          }
          kept.name ??= repeat.name;
          kept.email ??= repeat.email;
          kept.company ??= repeat.company;
          if (repeat.customValues)
            kept.customValues = {
              ...repeat.customValues,
              ...kept.customValues,
            };
        },
        (phone) => toMetaPhone(phone, code)
      );
      setParsedRows(unique);
      setInFileDropped(
        dropped.map(({ row, reason }) => ({
          phone: row.phone,
          name: row.name,
          reason: reason === 'no_phone' ? 'no_phone' : 'file_duplicate',
        }))
      );
      setHasTagsColumn(csvHasTags);
      setHasCompanyColumn(csvHasCompany);
    } catch {
      if (request === fileRequest.current) toast.error(t('toastError'));
    } finally {
      if (request === fileRequest.current) setParsingFile(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    // Dropping bypasses the picker's `accept`, so check here.
    if (!dropped || importing) return;
    if (!/\.csv$/i.test(dropped.name) && dropped.type !== 'text/csv') {
      toast.error(t('toastNotCsv'));
      return;
    }
    void loadFile(dropped);
  }

  async function handleImport() {
    if (parsedRows.length === 0 || parsingFile || importing || !countryCode)
      return;
    setImporting(true);
    setProgress({ stage: 'checking', done: 0, total: parsedRows.length });

    // Declared outside the try block on purpose: a large import is
    // dozens to hundreds of sequential requests, and if one fails
    // partway through, the catch block below still needs to report
    // what actually happened rather than lose it behind a generic
    // error toast — rows already written to the DB shouldn't vanish
    // from the summary just because a later request timed out.
    // In-file duplicates were already collapsed at parse time; they
    // still count as skipped in the summary.
    const report = emptyReport();
    report.skipped.push(...inFileDropped);
    let tagsAssigned = 0;
    let skippedNames: string[] = [];
    const toRow = (row: { phone: string; name?: string }): ReportRow => ({
      phone: row.phone,
      name: row.name,
    });
    const messageOf = (err: unknown): string =>
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message: unknown }).message)
          : t('toastError');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      const unique = importRows;

      // 1) Find which of these numbers this account already has, matched
      //    on the generated `phone_normalized` column (migration 022).
      //
      //    Looked up by the imported phones rather than by reading the
      //    whole contacts table: that read was unbounded and PostgREST
      //    caps a response at 1000 rows, so on a larger account it
      //    silently reported existing contacts as new. The cost is now
      //    proportional to the file, not to the account.
      const importedKeys = [
        ...new Set(
          unique
            .flatMap((row) => phoneLookupKeys(row.phone, countryCode))
            .filter(Boolean)
        ),
      ];
      const existingByPhone = new Map<
        string,
        { id: string; name: string | null }
      >();
      // Short URLs and a patient retry: a long filter that works once can
      // still get dropped on the next request.
      const lookupChunks = chunkIds(importedKeys, 1500);
      let checked = 0;
      for (let i = 0; i < lookupChunks.length; i++) {
        const slice = lookupChunks[i];
        const { data: existingRows, error } = await withRetry(
          () =>
            supabase
              .from('contacts')
              .select('id, phone_normalized, name')
              .eq('account_id', accountId)
              .in('phone_normalized', slice),
          { attempts: 5 }
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
            for (const key of phoneLookupKeys(r.phone_normalized, countryCode))
              existingByPhone.set(key, { id: r.id, name: r.name });
          }
        }
        checked += slice.length;
        setProgress({
          stage: 'checking',
          done: checked,
          total: importedKeys.length,
        });
      }

      // A number already on file is no longer dropped on the floor. The
      // row is treated as newer information about a contact we already
      // have — see planContactImport for the rules.
      const { toInsert, toMerge, duplicateRows } = planContactImport(
        unique,
        existingByPhone
      );
      const existingTagsById = new Map<string, string[]>();
      for (const ids of chunkIds(toMerge.map((row) => row.id))) {
        const result = await fetchAllRows<{
          contact_id: string;
          tag_id: string;
        }>((from, to) =>
          supabase
            .from('contact_tags')
            .select('contact_id, tag_id')
            .in('contact_id', ids)
            .order('id')
            .range(from, to)
        );
        if (result.error) throw result.error;
        for (const row of result.rows) {
          const tag = availableTags.find((tag) => tag.id === row.tag_id);
          if (tag)
            existingTagsById.set(row.contact_id, [
              ...(existingTagsById.get(row.contact_id) ?? []),
              tag.name,
            ]);
        }
      }
      report.skipped.push(
        ...duplicateRows.map((row) => ({
          ...toRow(row),
          reason: 'nothing_new' as const,
        }))
      );

      // 2) Resolve tag names → ids (admin+ may auto-create missing tags).
      //    Skip the round-trip when the import carries no tag names.
      //    Merge rows count here too: their tags are the whole point.
      const allTagNames = [
        ...toInsert.flatMap((row) => row.tagNames),
        ...toMerge.flatMap((m) => m.row.tagNames),
      ];
      let tagIdByKey = new Map<string, string>();
      if (allTagNames.length > 0) {
        setProgress({ stage: 'tags', done: 0 });
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
      const rowByContactId = new Map<string, ParsedContactRow>();
      const queueValues = (contactId: string, row: ParsedContactRow) => {
        if (row.tagNames.length)
          tagAssignments.push({ contactId, tagNames: row.tagNames });
        rowByContactId.set(contactId, row);
      };

      // Total units of work across both phases, for the progress
      // indicator — otherwise a multi-thousand-row import just shows a
      // spinner for however long it takes, indistinguishable from
      // being stuck.
      const totalWork = toInsert.length + toMerge.length;
      let doneWork = 0;
      setProgress({ stage: 'adding', done: 0, total: totalWork });

      // 3) Batch insert the genuinely-new rows in chunks. The DB
      //    unique index is the backstop: a 23505 (race, or a format
      //    that normalizes equal) counts as skipped, not failed.
      //    Each chunk (and each per-row fallback) is retried a few
      //    times on transient failures before giving up — see
      //    withRetry. This is safe to retry because a repeat of an
      //    already-succeeded insert just comes back as a 23505.
      const chunkSize = INSERT_BATCH_SIZE;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize)
          .sort((a, b) => a.phone.localeCompare(b.phone));
        await prepareContactPhones(
          supabase,
          accountId,
          chunk.map((row) => row.phone),
          countryCode
        );
        const rows = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          phone_conversion: row.phone_conversion ?? null,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        }));

        let data: { id: string; phone_normalized: string }[] | null = null;
        let error: { message: string } | null = null;
        try {
          ({ data, error } = await withRetry(() =>
            supabase
              .from('contacts')
              .insert(rows)
              .select('id, phone_normalized')
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
              report.imported.push(toRow(source));
              queueValues(singleData.id, source);
            } else if (isUniqueViolation(singleErr)) {
              report.skipped.push({
                ...toRow(source),
                reason: 'already_exists',
              });
            } else {
              report.failed.push({
                ...toRow(source),
                error: messageOf(singleErr),
              });
            }
          }
        } else {
          const sourceByPhone = new Map(
            chunk.map((row) => [toMetaPhone(row.phone, countryCode), row])
          );
          for (const inserted of data ?? []) {
            const source = sourceByPhone.get(inserted.phone_normalized);
            if (!source)
              throw new Error(
                'Could not match an imported contact to its CSV row'
              );
            report.imported.push(toRow(source));
            queueValues(inserted.id, source);
          }
        }

        doneWork += chunk.length;
        setProgress({ stage: 'adding', done: doneWork, total: totalWork });
      }
      setProgress({ stage: 'updating', done: doneWork, total: totalWork });

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
          const renameError = results[k].error;
          if (renameError) {
            report.failed.push({
              ...toRow(batch[k].row),
              error: t('detailRenameFailed', { error: messageOf(renameError) }),
            });
            renameFailures.add(batch[k].id);
          }
        }
        doneWork += batch.length;
        setProgress({ stage: 'updating', done: doneWork, total: totalWork });
      }

      for (const m of toMerge) {
        queueValues(m.id, m.row);
      }
      // Merge rows that only needed tags (no rename) never went through
      // the rename loop above, so progress hasn't counted them yet.
      doneWork += toMerge.length - renames.length;
      setProgress({ stage: 'updating', done: doneWork, total: totalWork });

      // 4) Wire tags onto the contacts we just created or merged. A failure
      //    here must not mask a successful contact import; the contacts
      //    it hit are listed in the report.
      setProgress({ stage: 'linking', done: 0 });
      const assigned = await assignImportedContactTags(
        supabase,
        tagAssignments,
        tagIdByKey
      );
      tagsAssigned = assigned.assigned;
      for (const [contactId, error] of assigned.failed) {
        const row = rowByContactId.get(contactId);
        if (row) {
          report.tagFailed.push({ ...toRow(row), tags: row.tagNames, error });
        }
      }
      if (report.tagFailed.length > 0) {
        toast.warning(
          t('toastTagsWarning', { count: report.tagFailed.length })
        );
      }

      setProgress({ stage: 'fields', done: 0 });
      const custom = await saveImportedCustomValues(
        supabase,
        Array.from(rowByContactId, ([contactId, row]) => ({
          contactId,
          values: row.customValues ?? {},
        }))
      );
      const namesByFieldId = new Map(
        customFields.map((field) => [field.id, field.field_name])
      );
      const customFieldNames = (contactId: string) =>
        (custom.saved.get(contactId) ?? [])
          .map((id) => namesByFieldId.get(id))
          .filter((name): name is string => Boolean(name));
      for (const [contactId, error] of custom.failed) {
        report.customFieldFailed.push({
          ...toRow(rowByContactId.get(contactId)!),
          error,
        });
      }
      if (custom.failed.size)
        toast.warning(t('customFieldsWarning', { count: custom.failed.size }));
      const importedByPhone = new Map(
        report.imported.map((row) => [normalizeKey(row.phone), row])
      );
      for (const [contactId, row] of rowByContactId) {
        const imported = importedByPhone.get(normalizeKey(row.phone));
        if (imported) imported.customFields = customFieldNames(contactId);
      }

      // Counted once per row touched, whether it was renamed, re-tagged
      // or both — the summary reports rows, not writes. A row whose only
      // contribution was a rename that failed is reported as failed, not
      // updated, so the two counts never describe the same row. A row
      // that changed nothing (name the same, every tag already on the
      // contact) is skipped, not updated.
      for (const m of toMerge) {
        const renameFailed = renameFailures.has(m.id);
        const renamed = m.rename !== null && !renameFailed;
        const tagged = assigned.contactIds.has(m.id);
        const fieldsSaved = custom.saved.has(m.id);
        if (!renamed && !tagged && !fieldsSaved) {
          const reported =
            renameFailed ||
            assigned.failed.has(m.id) ||
            custom.failed.has(m.id);
          if (!reported) {
            report.skipped.push({ ...toRow(m.row), reason: 'nothing_new' });
          }
          continue;
        }
        report.updated.push({
          ...toRow(m.row),
          existingTags: existingTagsById.get(m.id),
          customFields: customFieldNames(m.id),
          rename: renamed
            ? { from: m.previousName, to: m.rename as string }
            : undefined,
          tags: tagged ? m.row.tagNames : undefined,
        });
      }

      setProgress(null);
      report.skippedTags = skippedNames;
      setResult({ report, tagsAssigned, partial: false });
      const imported = report.imported.length;
      const updated = report.updated.length;
      const skipped = report.skipped.length;
      const failed = report.failed.length;
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
      if (
        report.imported.length +
          report.updated.length +
          report.skipped.length +
          report.failed.length +
          report.tagFailed.length +
          report.customFieldFailed.length >
        0
      ) {
        report.skippedTags = skippedNames;
        setResult({ report, tagsAssigned, partial: true });
      }
    } finally {
      setProgress(null);
      setImporting(false);
    }
  }

  const preview = importRows.slice(0, PREVIEW_LIMIT);
  const previewCustomFields = customFields.filter((field) =>
    csvCustomFieldIds.includes(field.id)
  );
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
      <DialogContent
        showCloseButton={!importing}
        className="bg-popover text-popover-foreground flex max-h-[min(90dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl [&>[data-slot=dialog-close]]:size-10"
      >
        <DialogHeader className="border-border shrink-0 gap-2 border-b px-5 py-5 pr-14">
          <DialogTitle className="text-lg font-semibold">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {result
              ? t('resultsHint')
              : importing
                ? t('importingNote')
                : t('intro')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {!result && !importing && (
            <>
              <button
                type="button"
                disabled={parsingFile}
                aria-label={file ? t('changeFile') : t('chooseCsv')}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                    setDragging(false);
                }}
                onDrop={handleDrop}
                className={cn(
                  'border-border bg-background focus-visible:ring-ring w-full rounded-lg border text-left transition-colors outline-none focus-visible:ring-2 disabled:cursor-wait',
                  file
                    ? 'flex items-center gap-3 p-3'
                    : 'hover:bg-muted/40 flex flex-col items-center justify-center gap-3 border-dashed px-5 py-7 text-center',
                  dragging && 'border-primary bg-primary-soft'
                )}
              >
                {file ? (
                  <>
                    <FileText className="text-muted-foreground size-6 shrink-0" />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span
                        className="text-foreground block truncate text-sm font-medium"
                        title={file.name}
                      >
                        {truncateFilename(file.name)}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {parsingFile
                          ? t('readingFile')
                          : t('rowsReady', { count: parsedRows.length })}
                      </span>
                    </span>
                    <span className="text-primary shrink-0 text-xs font-medium">
                      {t('changeFile')}
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="text-muted-foreground size-6" />
                    <span className="text-foreground text-sm font-medium">
                      {t('uploadDropzone')}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t('uploadHint')}
                    </span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) void loadFile(selected);
                }}
                className="hidden"
              />
              <details className="group text-sm">
                <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                  {t('csvGuide')}
                  <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="text-muted-foreground space-y-3 pt-2 text-xs leading-relaxed">
                  <p>
                    {t.rich('desc', {
                      phoneCode: csvColumn,
                      nameCode: csvColumn,
                      emailCode: csvColumn,
                      companyCode: csvColumn,
                      tagsCode: csvColumn,
                    })}
                  </p>
                  <p>{t('mergeHint')}</p>
                  <p>{t('customFieldsHint')}</p>
                </div>
              </details>
              {file && (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t('updateNote')}
                </p>
              )}
            </>
          )}
          {preview.length > 0 && !result && !importing && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-foreground text-sm font-semibold">
                  {t('preview', { count: preview.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {inFileDropped.length > 0 && (
                    <span className="bg-muted/90 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="size-3" />
                      {t('previewDuplicates', { count: inFileDropped.length })}
                    </span>
                  )}
                  {tagStats.rowsWithTags > 0 && (
                    <span className="bg-muted/90 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', {
                        tags: tagStats.unique,
                        contacts: tagStats.rowsWithTags,
                      })}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-border overflow-hidden rounded-lg border">
                <div
                  className="focus-visible:outline-ring overflow-x-auto focus-visible:outline-2"
                  tabIndex={0}
                  role="region"
                  aria-label={t('preview', { count: preview.length })}
                >
                  <div className="px-3 py-2">
                    <PhoneCountryWarning resolved={{ kind: 'csv', contacts: importRows }} />
                  </div>
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-border bg-background/60 border-b">
                        <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap">
                          {t('columns.phone')}
                        </th>
                        <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap">
                          {t('columns.name')}
                        </th>
                        <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap">
                          {t('columns.email')}
                        </th>
                        {previewHasCompany && (
                          <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap">
                            {t('columns.company')}
                          </th>
                        )}
                        {previewHasTags && (
                          <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap">
                            {t('columns.tags')}
                          </th>
                        )}
                        {previewCustomFields.map((field) => (
                          <th
                            key={field.id}
                            className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap"
                          >
                            {field.field_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-border/70 divide-y">
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="bg-popover/40 hover:bg-muted/30 transition-colors"
                        >
                          <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                            <PreviewCell
                              value={row.phone}
                              mono
                              maxWidth="max-w-[7.5rem]"
                            />
                          </td>
                          <td className="text-popover-foreground px-3 py-2.5">
                            <PreviewCell
                              value={row.name || '—'}
                              maxWidth="max-w-[8.5rem]"
                            />
                          </td>
                          <td className="text-muted-foreground px-3 py-2.5">
                            <PreviewCell
                              value={row.email || '—'}
                              maxWidth="max-w-[10rem]"
                            />
                          </td>
                          {previewHasCompany && (
                            <td className="text-muted-foreground px-3 py-2.5">
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
                          {previewCustomFields.map((field) => (
                            <td
                              key={field.id}
                              className="text-muted-foreground px-3 py-2.5"
                            >
                              <PreviewCell
                                value={row.customValues?.[field.id] || '—'}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsedRows.length > PREVIEW_LIMIT && (
                <p className="text-muted-foreground text-center text-xs">
                  {t('moreRows', { count: parsedRows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {!result && !importing && (
            <div className="border-border space-y-3 border-t pt-5">
              <p className="text-foreground text-sm font-semibold">
                {t('additionalTags')}
              </p>
              <TagMultiSelect
                className="bg-background min-h-10"
                tags={availableTags}
                value={selectedTagIds}
                disabled={importing}
                onToggle={(id) =>
                  setSelectedTagIds((prev) =>
                    prev.includes(id)
                      ? prev.filter((tagId) => tagId !== id)
                      : [...prev, id]
                  )
                }
                onClear={() => setSelectedTagIds([])}
              />
              <Input
                className="bg-background h-10"
                value={extraTags}
                disabled={importing || !canEditSettings}
                onChange={(event) => setExtraTags(event.target.value)}
                aria-label={t('newTags')}
                placeholder={t('newTags')}
              />
            </div>
          )}
          {!result && importing && progress && (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-52 flex-col items-center justify-center gap-3 py-8 text-center"
            >
              <Loader2 className="text-primary size-5 animate-spin" />
              <p className="text-popover-foreground text-sm font-medium">
                {t(`stage.${progress.stage}`)}
              </p>
              {progress.total !== undefined && progress.total > 0 && (
                <div className="w-full max-w-sm space-y-1.5">
                  <div className="bg-muted h-1.5 w-full rounded-full">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('progressCounts', {
                      done: progress.done,
                      total: progress.total,
                      remaining: Math.max(0, progress.total - progress.done),
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <p
                role="status"
                className="text-foreground text-base font-semibold"
              >
                {result.partial ? t('importPartial') : t('importComplete')}
              </p>
              {result.partial && (
                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  {t('importPartialHint')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                {result.report.imported.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-emerald-800 dark:text-emerald-300">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', {
                      count: result.report.imported.length,
                    })}
                  </div>
                )}
                {result.report.updated.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-emerald-800 dark:text-emerald-300">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultUpdated', {
                      count: result.report.updated.length,
                    })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.report.skipped.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', {
                      count: result.report.skipped.length,
                    })}
                  </div>
                )}
                {result.report.tagFailed.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-300">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultTagFailed', {
                      count: result.report.tagFailed.length,
                    })}
                  </div>
                )}
                {result.report.customFieldFailed.length > 0 && (
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {t('customFieldsWarning', {
                      count: result.report.customFieldFailed.length,
                    })}
                  </p>
                )}
                {result.report.failed.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-300">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.report.failed.length })}
                  </div>
                )}
              </div>
              <ImportReportDetails report={result.report} />
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => handleOpenChange(false)}
            className="h-auto min-h-10 px-4 py-2 whitespace-normal"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || parsingFile || importing}
              onClick={handleImport}
              className="h-auto min-h-10 px-5 py-2 whitespace-normal"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length > 0
                ? t('importBtn', { count: parsedRows.length })
                : t('importBtn', { count: 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
