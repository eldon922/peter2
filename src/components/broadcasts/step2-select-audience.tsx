'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { dedupeByPhone } from '@/lib/contacts/dedupe';
import { UNTAGGED } from '@/lib/contacts/tag-filter';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { useAudience } from '@/hooks/use-audience';
import type {
  AudienceConfig,
  CustomFieldFilter,
  CustomFieldOperator,
} from '@/lib/broadcasts/audience';
import { Button } from '@/components/ui/button';
import { TagMultiSelect } from '@/components/ui/tag-multi-select';
import { AudienceContactList } from '@/components/broadcasts/audience-contact-list';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

type AudienceType = AudienceConfig['type'];

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');
  const importT = useTranslations('Contacts.importModal');
  const csvRequest = useRef(0);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState('');

  const OPERATOR_OPTIONS = useMemo<
    { value: CustomFieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo<
    {
      type: AudienceType;
      label: string;
      description: string;
      icon: typeof Users;
    }[]
  >(
    () => [
      {
        type: 'all',
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags',
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'custom_field',
        label: t('selectAudience.method.customField'),
        description: t('selectAudience.customFieldDesc'),
        icon: Filter,
      },
      {
        type: 'csv',
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
    ],
    [t]
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const {
    resolved,
    count: estimatedCount,
    excludedCount,
    loading: loadingCount,
    failed: estimateFailed,
  } = useAudience(audience);
  // Infinity until the server answers — matches
  // use-broadcast-sending.ts's fallback, so a still-loading or failed
  // lookup never shows a false warning. Same route as the send-time
  // check, so the two never disagree: it reflects Meta's live
  // messaging-limit tier for this account (see recipientLimitForTier
  // in broadcast-limits.ts).
  const [recipientLimit, setRecipientLimit] = useState(Infinity);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/broadcasts/recipient-limit')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { limit?: number } | null) => {
        if (!cancelled && typeof data?.limit === 'number') {
          setRecipientLimit(data.limit);
        }
      })
      .catch(() => {
        // Left at Infinity — no warning shown rather than a wrong one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags([
          {
            id: UNTAGGED,
            name: t('selectAudience.untagged'),
            color: '#94a3b8',
            user_id: '',
            created_at: '',
          },
          ...(data ?? []),
        ]);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  // The estimate is the source of truth: it already covers partially
  // configured audiences (null) and exclusions that empty the list (0).
  const isValid = !loadingCount && (estimatedCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('selectAudience.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map(
          (option: {
            type: AudienceType;
            label: string;
            description: string;
            icon: typeof Users;
          }) => {
            const isSelected = audience.type === option.type;
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                onClick={() =>
                  onUpdate({
                    ...audience,
                    type: option.type,
                    // Wipe shape fields from other types to avoid stale
                    // config leaking across selections.
                    tagIds:
                      option.type === 'tags' ? audience.tagIds : undefined,
                    customField:
                      option.type === 'custom_field'
                        ? audience.customField
                        : undefined,
                    csvContacts:
                      option.type === 'csv' ? audience.csvContacts : undefined,
                  })
                }
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          }
        )}
      </div>

      {audience.type === 'tags' && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectTags')}
          </p>
          {loadingTags ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <TagMultiSelect
              tags={tags}
              value={audience.tagIds ?? []}
              onToggle={toggleTag}
              onClear={() => onUpdate({ ...audience, tagIds: [] })}
            />
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.method.customField')}
          </p>
          {loadingFields ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : customFields.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                {OPERATOR_OPTIONS.map(
                  (op: { value: CustomFieldOperator; label: string }) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  )
                )}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              />
            </div>
          )}
        </div>
      )}

      {audience.type === 'csv' && (
        <div
          className="border-border bg-card/50 space-y-2 rounded-xl border p-4"
          aria-busy={csvLoading}
        >
          <label
            htmlFor="broadcast-csv"
            className="text-foreground block text-sm font-medium"
          >
            {t('selectAudience.method.csv')}
          </label>
          <input
            id="broadcast-csv"
            type="file"
            accept=".csv,text/csv"
            className="text-muted-foreground file:border-border file:bg-muted file:text-foreground block w-full text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-2"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              const request = ++csvRequest.current;
              setCsvError('');
              onUpdate({ ...audience, csvContacts: [] });
              if (!file) return;
              setCsvLoading(true);
              try {
                const { rows } = parseContactCsv(await file.text());
                const { unique } = dedupeByPhone(rows);
                if (request !== csvRequest.current) return;
                if (unique.length === 0)
                  setCsvError(importT('toastNoValidRows'));
                onUpdate({
                  ...audience,
                  csvContacts: unique.map(({ phone, name }) => ({
                    phone,
                    name,
                  })),
                });
              } catch {
                if (request === csvRequest.current)
                  setCsvError(importT('toastNoValidRows'));
              } finally {
                if (request === csvRequest.current) setCsvLoading(false);
              }
            }}
          />
          <p className="text-muted-foreground text-xs">
            {importT('uploadHint')}
          </p>
          {csvLoading && <Loader2 className="size-4 animate-spin" />}
          {csvError && (
            <p role="alert" className="text-xs text-red-500">
              {csvError}
            </p>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.noTagsFound')}
          </p>
        ) : (
          <TagMultiSelect
            tags={tags}
            value={audience.excludeTagIds ?? []}
            onToggle={toggleExcludeTag}
            onClear={() => onUpdate({ ...audience, excludeTagIds: [] })}
            variant="danger"
          />
        )}
      </div>

      {/* Audience Summary */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <p className="text-foreground mb-2 text-sm font-medium">
          {t('selectAudience.summary')}
        </p>
        {!loadingCount && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-300">
            {t('selectAudience.excludedCount', { count: excludedCount })}
          </p>
        )}
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.calculating')}
            </span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="text-primary h-4 w-4" />
            <span className="text-foreground text-sm">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.estimatedRecipients')}
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {estimateFailed
              ? t('selectAudience.estimateFailed')
              : t('selectAudience.selectToEstimate')}
          </p>
        )}
        {!loadingCount && estimatedCount === 0 && (
          <p className="mt-2 text-xs text-amber-500">
            {t('selectAudience.noMatch')}
          </p>
        )}
        {!loadingCount && resolved && (estimatedCount ?? 0) > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium">
              {t('contactList.title')}
            </p>
            <AudienceContactList resolved={resolved} />
          </div>
        )}
        {!loadingCount &&
          estimatedCount !== null &&
          estimatedCount > recipientLimit && (
            <p className="mt-2 text-xs text-amber-500">
              This audience is above this account&apos;s limit of about{' '}
              {recipientLimit.toLocaleString()} recipients. Some may not be sent
              the first time — after it finishes, open the broadcast and press
              Retry to send the rest.
            </p>
          )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
