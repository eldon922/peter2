'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, MessageTemplate, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAudience } from '@/hooks/use-audience';
import {
  fetchAudiencePage,
  type AudienceConfig,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';
import {
  fetchCustomValueIndex,
  resolveVariables,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message';
import { contactDisplayName } from '@/lib/contacts/display-name';
import { AudienceContactList } from '@/components/broadcasts/audience-contact-list';
import { BroadcastMessagePreview } from '@/components/broadcasts/message-preview';
import { TagChips } from '@/components/broadcasts/tag-chips';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl: string;
  headerMediaId: string;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  variables,
  headerMediaUrl,
  headerMediaId,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const { resolved, count, loading: loadingReach } = useAudience(audience);
  const reach = count ?? 0;

  const [allTags, setAllTags] = useState<Tag[]>([]);
  useEffect(() => {
    createClient()
      .from('tags')
      .select('*')
      .then(({ data }) => setAllTags((data ?? []) as Tag[]));
  }, []);
  const includeTags = allTags.filter((tag) => audience.tagIds?.includes(tag.id));
  const excludeTags = allTags.filter((tag) =>
    audience.excludeTagIds?.includes(tag.id),
  );

  // The first recipient stands in for the message every contact gets, run
  // through the same variable resolution the real send uses.
  const [sample, setSample] = useState<{
    source: ResolvedAudience;
    contact: Contact | null;
    custom?: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [first] = await fetchAudiencePage(supabase, resolved, 0, 1);
      let contact: Contact | null = null;
      let custom: Map<string, string> | undefined;
      if (first && resolved.kind === 'csv') {
        contact = { phone: first.phone, name: first.name ?? undefined } as Contact;
      } else if (first) {
        const { data } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', first.id)
          .maybeSingle();
        contact = (data as Contact | null) ?? null;
        if (contact) {
          custom = (await fetchCustomValueIndex(supabase, [contact.id])).get(
            contact.id,
          );
        }
      }
      if (!cancelled) setSample({ source: resolved, contact, custom });
    })().catch(() => {
      if (!cancelled) setSample({ source: resolved, contact: null });
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const sampleContact = sample?.source === resolved ? sample.contact : null;
  const previewBody = useMemo(() => {
    if (!sampleContact) return template.body_text;
    const params = resolveVariables(variables, sampleContact, sample?.custom);
    return renderTemplateBody(template.body_text, params) ?? '';
  }, [template.body_text, variables, sampleContact, sample?.custom]);
  const previewLabel = sampleContact
    ? t('scheduleSend.previewFor', {
        name: contactDisplayName(sampleContact),
      })
    : t('personalize.previewSample');

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  const mappedVariables = Object.keys(variables).length;
  const headerMedia = headerMediaId
    ? t('scheduleSend.mediaUploaded')
    : headerMediaUrl || null;

  const audienceBlock = (
    <div className="space-y-1.5">
      <p className="text-foreground">{audienceLabel}</p>
      {includeTags.length > 0 && <TagChips tags={includeTags} />}
      {excludeTags.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('scheduleSend.excluding')}</p>
          <TagChips tags={excludeTags} danger />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="break-words text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.language')}</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            {audienceBlock}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{reach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.variables')}</p>
            <p className="text-foreground">
              {t('scheduleSend.variablesMapped', { count: mappedVariables })}
            </p>
          </div>
          {headerMedia && (
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('scheduleSend.headerMedia')}</p>
              <p className="truncate text-foreground">{headerMedia}</p>
            </div>
          )}
        </div>
      </div>

      {/* Message preview */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{t('scheduleSend.messagePreview')}</p>
          <span className="text-xs text-muted-foreground">({previewLabel})</span>
        </div>
        <BroadcastMessagePreview
          template={template}
          bodyText={previewBody}
          mediaUrl={headerMediaUrl}
        />
      </div>

      {/* Recipients */}
      {resolved && reach > 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">{t('contactList.title')}</p>
          <AudienceContactList resolved={resolved} />
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!name.trim() || isProcessing || loadingReach || reach === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            <Send className="h-4 w-4" />
            {t('scheduleSend.sendNow')}
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('scheduleSend.confirmTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('scheduleSend.confirmDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t('scheduleSend.broadcastName')}</p>
                  <p className="break-words text-popover-foreground">{name}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
                  <p className="break-words text-popover-foreground">
                    {template.name} · {template.language ?? 'en_US'}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
                  {audienceBlock}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('scheduleSend.recipients')}</p>
                  <p className="font-medium text-popover-foreground">
                    {t('scheduleSend.recipientCount', { count: reach })}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {t('scheduleSend.messagePreview')} ({previewLabel})
                </p>
                <BroadcastMessagePreview
                  template={template}
                  bodyText={previewBody}
                  mediaUrl={headerMediaUrl}
                />
              </div>
              <p className="text-xs text-amber-500">{t('scheduleSend.cannotUndo')}</p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {t('scheduleSend.sendTo', { count: reach })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
