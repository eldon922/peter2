'use client';

import { useEffect, useMemo, useState } from 'react';
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
    for (const { key, label } of placeholders) {
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) {
        missing.push(label);
      }
    }
    return missing;
  }, [placeholders, variables]);

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
        <h2 className="text-foreground text-lg font-semibold">
          {t('personalize.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('personalize.subtitle')}
        </p>
      </div>

      {mediaHeaderType && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <div className="mb-3 flex items-center gap-2">
            <ImageIcon className="text-primary h-4 w-4" />
            <p className="text-foreground text-sm font-medium">
              {t('personalize.headerImage')}
            </p>
            <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase">
              {mediaHeaderType}
            </span>
          </div>

          <HeaderMediaPicker
            kind={mediaHeaderType}
            value={headerMedia}
            onChange={onHeaderMediaChange}
            defaultUrl={template.header_media_url}
          />
        </div>
      )}

      {placeholders.length === 0 && !mediaHeaderType ? (
        <div className="border-border bg-card/50 rounded-xl border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            {t('personalize.noPreview')}
          </p>
        </div>
      ) : placeholders.length === 0 ? null : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => {
            const { key, label } = placeholder;
            const mapping = variables[key] ?? { type: 'static', value: '' };

            return (
              <div
                key={key}
                className="border-border bg-card/50 rounded-xl border p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium">
                    {label}
                  </span>
                </div>

                {'url' in placeholder && (
                  <p className="text-muted-foreground mb-3 text-xs break-all">
                    {t('personalize.buttonUrlHint', {
                      url: placeholder.url as string,
                    })}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                      {t('personalize.type')}
                    </label>
                    <Select
                      value={mapping.type}
                      items={[
                        { value: 'static', label: t('personalize.typeStatic') },
                        { value: 'field', label: t('personalize.typeContact') },
                        {
                          value: 'custom_field',
                          label: t('personalize.typeCustom'),
                        },
                      ]}
                      onValueChange={(val) =>
                        updateVariable(key, {
                          type: val as VariableType,
                          value: '',
                        })
                      }
                    >
                      <SelectTrigger className="border-border bg-muted text-foreground w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-popover">
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

                  <div>
                    <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                      {mapping.type === 'static'
                        ? t('personalize.staticValue')
                        : t('personalize.contactField')}
                    </label>
                    {mapping.type === 'static' ? (
                      <Input
                        value={mapping.value}
                        onChange={(e) =>
                          updateVariable(key, { value: e.target.value })
                        }
                        placeholder="Enter value..."
                        className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                      />
                    ) : mapping.type === 'field' ? (
                      <Select
                        value={mapping.value || undefined}
                        items={contactFields.map((field) => ({
                          value: field.value,
                          label: t(`personalize.fieldMap.${field.labelKey}`),
                        }))}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="border-border bg-muted text-foreground w-full">
                          <SelectValue
                            placeholder={t('personalize.selectContactField')}
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {contactFields.map((field) => (
                            <SelectItem key={field.value} value={field.value}>
                              {t(`personalize.fieldMap.${field.labelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={mapping.value || undefined}
                        items={customFields.map((field) => ({
                          value: field.id,
                          label: field.field_name,
                        }))}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="border-border bg-muted text-foreground w-full">
                          <SelectValue
                            placeholder={
                              loadingFields
                                ? 'Loading…'
                                : customFields.length === 0
                                  ? 'No custom fields'
                                  : 'Select custom field…'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {customFields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.field_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Preview — rendered as a WhatsApp-style bubble so the user
          sees approximately what the recipient will see. */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eye className="text-primary h-4 w-4" />
            <p className="text-foreground text-sm font-medium">
              {t('personalize.preview')}
            </p>
            <span className="text-muted-foreground text-xs">
              ({previewLabel})
            </span>
            {loadingPreview && (
              <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
            )}
          </div>
          <FormattingToggle
            checked={formatted}
            onCheckedChange={setFormatted}
          />
        </div>
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

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">
            {unmappedKeys.join(', ')}
          </span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

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
          disabled={unmappedKeys.length > 0 || mediaError !== null}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
