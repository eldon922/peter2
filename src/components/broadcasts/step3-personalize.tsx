'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Eye, ImageIcon, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  bodyPlaceholderKeys,
  HEADER_VARIABLE_KEY,
  resolveVariables,
  resolveHeaderVariable,
  resolveButtonVariables,
  buttonVariables,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message';
import { BroadcastMessagePreview } from './message-preview';
import {
  headerMediaError,
  type HeaderMedia,
} from '@/lib/broadcasts/header-media';
import { isHeaderMediaKind } from '@/lib/media-specs';
import { contactDisplayName } from '@/lib/contacts/display-name';
import { FormattingToggle } from '@/components/broadcasts/formatting-toggle';
import { HeaderMediaPicker } from '@/components/broadcasts/header-media-picker';

type VariableType = 'static' | 'field' | 'custom_field';

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  /** Image/video/document for the template's header, when it has one. */
  headerMedia: HeaderMedia;
  onHeaderMediaChange: (media: HeaderMedia) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = [
  { value: 'name', labelKey: 'name' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'email', labelKey: 'email' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  account_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  headerMedia,
  onHeaderMediaChange,
  onNext,
  onBack,
}: Step3Props) {
  const t = useTranslations('Broadcasts.wizard');
  const formId = useId();
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [formatted, setFormatted] = useState(true);
  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const placeholders = useMemo(
    () => [
      ...(template.header_type === 'text'
        ? bodyPlaceholderKeys(template.header_content).map((key) => ({
            key: HEADER_VARIABLE_KEY,
            label: `${t('personalize.headerVariable')} {{${key}}}`,
          }))
        : []),
      ...bodyPlaceholderKeys(template.body_text).map((key) => ({
        key,
        label: `{{${key}}}`,
      })),
      ...buttonVariables(template).map(({ key, index, button }) => ({
        key,
        label: t('personalize.buttonVariable', {
          number: index + 1,
          name: button.text,
        }),
        url: button.url,
      })),
    ],
    [template, t]
  );

  // A template with an IMAGE/VIDEO/DOCUMENT header needs that media on
  // every send — Meta rejects the broadcast without it.
  const mediaHeaderType = isHeaderMediaKind(template.header_type)
    ? template.header_type
    : null;
  const mediaError = mediaHeaderType ? headerMediaError(headerMedia) : null;

  /**
   * A placeholder is "unmapped" if the user hasn't picked either a
   * static value or a field/custom-field source. Blocks Next until
   * every placeholder has something — otherwise the broadcast would
   * ship with empty strings and confuse recipients.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const { key } of placeholders) {
      const mapping = variables[key];
      if (
        !mapping?.value?.trim() ||
        (mapping.type === 'custom_field' &&
          (loadingFields ||
            !customFields.some((field) => field.id === mapping.value))) ||
        (mapping.type === 'field' &&
          !contactFields.some((field) => field.value === mapping.value))
      ) {
        missing.push(key);
      }
    }
    return missing;
  }, [placeholders, variables, customFields, loadingFields]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? {
      type: 'static' as VariableType,
      value: '',
    };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  const previewContact = firstContact ?? SAMPLE_CONTACT;
  const previewVariables = Object.fromEntries(
    placeholders.map(({ key }) => [
      key,
      variables[key]?.value
        ? variables[key]
        : {
            type: 'static' as const,
            value: key === HEADER_VARIABLE_KEY ? '' : `{{${key}}}`,
          },
    ])
  );
  const previewText =
    renderTemplateBody(
      template.body_text,
      resolveVariables(
        previewVariables,
        previewContact,
        firstContactCustomValues
      )
    ) ?? '';
  const previewHeader = resolveHeaderVariable(
    variables,
    previewContact,
    firstContactCustomValues
  );

  const previewLabel = firstContact
    ? contactDisplayName(firstContact)
    : t('personalize.previewSample');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-xl font-semibold tracking-tight">
          {t('personalize.title')}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm leading-relaxed">
          {t('personalize.subtitle')}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {mediaHeaderType && (
            <section className="border-border bg-card rounded-xl border p-5">
              <div className="mb-4 flex items-center gap-2">
                <ImageIcon className="text-muted-foreground size-4" />
                <h3 className="text-foreground text-sm font-semibold">
                  {t('personalize.headerImage')}
                </h3>
                <span className="text-muted-foreground text-xs uppercase">
                  {mediaHeaderType}
                </span>
              </div>
              <HeaderMediaPicker
                kind={mediaHeaderType}
                value={headerMedia}
                onChange={onHeaderMediaChange}
                defaultUrl={template.header_media_url}
              />
            </section>
          )}

          {placeholders.length > 0 ? (
            <div className="border-border bg-card divide-border divide-y rounded-xl border">
              {placeholders.map((placeholder) => {
                const { key, label } = placeholder;
                const id = `${formId}-${key}`;
                const mapping = variables[key] ?? { type: 'static', value: '' };
                const missing = unmappedKeys.includes(key);
                const valueLabel =
                  mapping.type === 'static'
                    ? t('personalize.staticValue')
                    : mapping.type === 'field'
                      ? t('personalize.contactField')
                      : t('personalize.customField');
                return (
                  <fieldset key={key} className="min-w-0 space-y-4 p-5">
                    <legend className="sr-only">{label}</legend>
                    <div className="space-y-1.5">
                      <h3
                        id={`${id}-label`}
                        className="text-foreground text-sm font-semibold break-words"
                      >
                        {label}
                      </h3>
                      {'url' in placeholder && (
                        <p className="text-muted-foreground text-xs leading-relaxed break-all">
                          {t('personalize.buttonUrlHint', {
                            url: placeholder.url as string,
                          })}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <label
                          id={`${id}-source-label`}
                          htmlFor={`${id}-source`}
                          className="text-muted-foreground block text-xs font-medium"
                        >
                          {t('personalize.type')}
                        </label>
                        <Select
                          value={mapping.type}
                          items={[
                            {
                              value: 'static',
                              label: t('personalize.typeStatic'),
                            },
                            {
                              value: 'field',
                              label: t('personalize.typeContact'),
                            },
                            {
                              value: 'custom_field',
                              label: t('personalize.typeCustom'),
                            },
                          ]}
                          onValueChange={(val) =>
                            updateVariable(key, {
                              type: (val as VariableType) || 'static',
                              value: '',
                            })
                          }
                        >
                          <SelectTrigger
                            id={`${id}-source`}
                            aria-labelledby={`${id}-label ${id}-source-label`}
                            className="bg-background w-full min-w-0 scroll-mb-48 data-[size=default]:h-10 [&_[data-slot=select-value]]:truncate"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="static">
                              {t('personalize.typeStatic')}
                            </SelectItem>
                            <SelectItem value="field">
                              {t('personalize.typeContact')}
                            </SelectItem>
                            <SelectItem value="custom_field">
                              {t('personalize.typeCustom')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <label
                          id={`${id}-value-label`}
                          htmlFor={`${id}-value`}
                          className="text-muted-foreground block text-xs font-medium"
                        >
                          {valueLabel}
                        </label>
                        {mapping.type === 'static' ? (
                          <Input
                            id={`${id}-value`}
                            aria-labelledby={`${id}-label ${id}-value-label`}
                            aria-describedby={
                              missing ? `${id}-hint` : undefined
                            }
                            aria-required
                            value={mapping.value}
                            onChange={(e) =>
                              updateVariable(key, { value: e.target.value })
                            }
                            placeholder={t('personalize.valuePlaceholder')}
                            className="bg-background h-10 scroll-mb-48"
                          />
                        ) : (
                          <Select
                            value={missing ? null : mapping.value}
                            disabled={
                              mapping.type === 'custom_field' &&
                              (loadingFields || customFields.length === 0)
                            }
                            items={
                              mapping.type === 'field'
                                ? contactFields.map((field) => ({
                                    value: field.value,
                                    label: t(
                                      `personalize.fieldMap.${field.labelKey}`
                                    ),
                                  }))
                                : customFields.map((field) => ({
                                    value: field.id,
                                    label: field.field_name,
                                  }))
                            }
                            onValueChange={(val) =>
                              updateVariable(key, { value: val || '' })
                            }
                          >
                            <SelectTrigger
                              id={`${id}-value`}
                              aria-labelledby={`${id}-label ${id}-value-label`}
                              aria-describedby={
                                missing ? `${id}-hint` : undefined
                              }
                              aria-required
                              className="bg-background w-full min-w-0 scroll-mb-48 items-start whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-10 *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:wrap-anywhere *:data-[slot=select-value]:whitespace-normal"
                            >
                              <SelectValue
                                placeholder={
                                  mapping.type === 'field'
                                    ? t('personalize.selectContactField')
                                    : loadingFields
                                      ? t('personalize.loadingFields')
                                      : customFields.length === 0
                                        ? t('personalize.noCustomFields')
                                        : mapping.value && missing
                                          ? t('personalize.fieldUnavailable')
                                          : t('personalize.selectCustomField')
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {mapping.type === 'field'
                                ? contactFields.map((field) => (
                                    <SelectItem
                                      key={field.value}
                                      value={field.value}
                                    >
                                      {t(
                                        `personalize.fieldMap.${field.labelKey}`
                                      )}
                                    </SelectItem>
                                  ))
                                : customFields.map((field) => (
                                    <SelectItem
                                      key={field.id}
                                      value={field.id}
                                      className="items-start py-2 [&>*]:min-w-0 [&>*]:shrink [&>*]:wrap-anywhere [&>*]:whitespace-normal"
                                    >
                                      {field.field_name}
                                    </SelectItem>
                                  ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    {missing && (
                      <p
                        id={`${id}-hint`}
                        className="text-xs leading-relaxed text-amber-800 dark:text-amber-200"
                      >
                        {t('personalize.valueRequired')}
                      </p>
                    )}
                  </fieldset>
                );
              })}
            </div>
          ) : (
            !mediaHeaderType && (
              <p className="text-muted-foreground py-4 text-sm">
                {t('personalize.noVariables')}
              </p>
            )
          )}
        </div>

        <section
          aria-label={t('personalize.preview')}
          className="border-border bg-card min-w-0 overflow-hidden rounded-xl border lg:sticky lg:top-6"
        >
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Eye className="text-muted-foreground size-4" />
              <h3 className="text-foreground text-sm font-semibold">
                {t('personalize.preview')}
              </h3>
              {loadingPreview && (
                <Loader2
                  className="text-muted-foreground size-4 animate-spin"
                  aria-label={t('personalize.loadingFields')}
                />
              )}
            </div>
            <p className="text-muted-foreground text-xs break-words">
              {firstContact
                ? t('personalize.previewContact', { name: previewLabel })
                : previewLabel}
            </p>
            <FormattingToggle
              checked={formatted}
              onCheckedChange={setFormatted}
            />
          </div>
          <div className="p-3 pt-0 lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto">
            <BroadcastMessagePreview
              template={template}
              bodyText={previewText}
              headerText={previewHeader}
              buttonParams={resolveButtonVariables(
                variables,
                previewContact,
                firstContactCustomValues
              )}
              formatted={formatted}
              mediaUrl={
                headerMedia.mediaId
                  ? `/api/whatsapp/media/${headerMedia.mediaId}`
                  : headerMedia.url
              }
            />
          </div>
        </section>
      </div>

      <div className="border-border bg-background sticky bottom-0 z-10 space-y-3 border-t py-4">
        {unmappedKeys.length > 0 && (
          <p
            role="status"
            className="text-sm text-amber-800 dark:text-amber-200"
          >
            {t('personalize.missingValues', { count: unmappedKeys.length })}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" onClick={onBack} className="h-10 px-4">
            <ArrowLeft className="size-4" />
            {t('back')}
          </Button>
          <Button
            onClick={onNext}
            disabled={unmappedKeys.length > 0 || mediaError !== null}
            className="h-10 px-5"
          >
            {t('next')}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
