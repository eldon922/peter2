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
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  CalendarClock,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAudience } from '@/hooks/use-audience';
import type { SendingStage } from '@/hooks/use-broadcast-sending';
import {
  fetchAudiencePage,
  type AudienceConfig,
  type ResolvedAudience,
} from '@/lib/broadcasts/audience';
import {
  fetchCustomValueIndex,
  resolveVariables,
  resolveHeaderVariable,
  resolveButtonVariables,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message';
import { contactDisplayName } from '@/lib/contacts/display-name';
import { AudienceContactList } from '@/components/broadcasts/audience-contact-list';
import { BroadcastMessagePreview } from '@/components/broadcasts/message-preview';
import { TagChips } from '@/components/broadcasts/tag-chips';
import { FormattingToggle } from '@/components/broadcasts/formatting-toggle';
import { ScheduleDialog } from '@/components/broadcasts/schedule-dialog';
import { PhoneCountryWarning } from '@/components/phone-country-warning';
import { formatScheduledAt } from '@/lib/broadcasts/schedule';
import { UNTAGGED } from '@/lib/contacts/tag-filter';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl: string;
  headerMediaId: string;
  onSend: () => void;
  /** Saves the broadcast to go out at `iso` instead of sending now. */
  onSchedule: (iso: string) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  /** Set when the broadcast was saved but the last step failed: nothing more can be sent from here. */
  savedBroadcastId?: string | null;
  onOpenSaved?: () => void;
  isProcessing: boolean;
  progress: number;
  stage: SendingStage | null;
  counts: { done: number; total: number } | null;
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
  onSchedule,
  onSaveDraft,
  onBack,
  savedBroadcastId,
  onOpenSaved,
  isProcessing,
  progress,
  stage,
  counts,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<string | null>(null);
  const [formatted, setFormatted] = useState(true);
  const { resolved, count, loading: loadingReach } = useAudience(audience);
  const reach = count ?? 0;
  const locked = Boolean(savedBroadcastId);

  const [allTags, setAllTags] = useState<Tag[]>([]);
  useEffect(() => {
    createClient()
      .from('tags')
      .select('*')
      .then(({ data }) => setAllTags((data ?? []) as Tag[]));
  }, []);
  const includeTags = allTags.filter((tag) =>
    audience.tagIds?.includes(tag.id)
  );
  const excludeTags = allTags.filter((tag) =>
    audience.excludeTagIds?.includes(tag.id)
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
        contact = {
          phone: first.phone,
          name: first.name ?? undefined,
        } as Contact;
      } else if (first) {
        const { data } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', first.id)
          .maybeSingle();
        contact = (data as Contact | null) ?? null;
        if (contact) {
          custom = (await fetchCustomValueIndex(supabase, [contact.id])).get(
            contact.id
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
  const previewHeader = sampleContact
    ? resolveHeaderVariable(variables, sampleContact, sample?.custom)
    : undefined;
  const previewButtons = sampleContact
    ? resolveButtonVariables(variables, sampleContact, sample?.custom)
    : undefined;
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
      {audience.tagIds?.includes(UNTAGGED) && (
        <p>{t('selectAudience.untagged')}</p>
      )}
      {(excludeTags.length > 0 ||
        audience.excludeTagIds?.includes(UNTAGGED)) && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            {t('scheduleSend.excluding')}
          </p>
          <TagChips tags={excludeTags} danger />
          {audience.excludeTagIds?.includes(UNTAGGED) && (
            <p>{t('selectAudience.untagged')}</p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-xl font-semibold tracking-tight">
          {t('scheduleSend.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {/* Broadcast Name */}
          <div>
            <label
              htmlFor="broadcast-name"
              className="text-foreground mb-1.5 block text-sm font-medium"
            >
              {t('scheduleSend.broadcastName')}
            </label>
            <Input
              id="broadcast-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t('scheduleSend.broadcastNamePlaceholder')}
              className="bg-background h-10 scroll-mb-48"
            />
          </div>

          {/* Summary Card */}
          <div className="border-border bg-card space-y-4 rounded-xl border p-5">
            <p className="text-foreground text-sm font-medium">
              {t('scheduleSend.summary')}
            </p>
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">
                  {t('scheduleSend.template')}
                </p>
                <p className="text-foreground break-words">{template.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t('scheduleSend.language')}
                </p>
                <p className="text-foreground">
                  {template.language ?? 'en_US'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t('scheduleSend.audience')}
                </p>
                {audienceBlock}
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t('scheduleSend.estimatedReach')}
                </p>
                <div className="flex items-center gap-1.5">
                  {loadingReach ? (
                    <Loader2 className="text-primary h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Users className="text-primary h-3.5 w-3.5" />
                      <p className="text-foreground font-medium">
                        {reach.toLocaleString()}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t('scheduleSend.variables')}
                </p>
                <p className="text-foreground">
                  {t('scheduleSend.variablesMapped', {
                    count: mappedVariables,
                  })}
                </p>
              </div>
              {headerMedia && (
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    {t('scheduleSend.headerMedia')}
                  </p>
                  <p className="text-foreground truncate">{headerMedia}</p>
                </div>
              )}
            </div>
          </div>

          {/* Recipients */}
          {resolved && reach > 0 && (
            <div className="border-border bg-card space-y-2 rounded-xl border p-5">
              <p className="text-foreground text-sm font-medium">
                {t('contactList.title')}
              </p>
              <AudienceContactList resolved={resolved} />
            </div>
          )}

          <PhoneCountryWarning resolved={resolved} />
        </div>
        {/* Message preview */}
        <section
          aria-label={t('scheduleSend.messagePreview')}
          className="border-border bg-card min-w-0 space-y-4 rounded-xl border p-4 sm:p-5 lg:sticky lg:top-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-foreground text-sm font-medium">
                {t('scheduleSend.messagePreview')}
              </p>
              <span className="text-muted-foreground text-xs">
                {previewLabel}
              </span>
            </div>
            <FormattingToggle
              checked={formatted}
              onCheckedChange={setFormatted}
            />
          </div>
          <div className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
            <BroadcastMessagePreview
              template={template}
              bodyText={previewBody}
              headerText={previewHeader}
              buttonParams={previewButtons}
              mediaUrl={headerMediaUrl}
              formatted={formatted}
            />
          </div>
        </section>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <p className="text-foreground text-sm font-medium">
                {stage
                  ? t(`scheduleSend.stage.${stage}`)
                  : t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-primary text-xs font-medium">
              {progress}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {counts && (
            <p className="text-muted-foreground mt-2 text-xs">
              {t('scheduleSend.savingCounts', {
                done: counts.done,
                total: counts.total,
                remaining: Math.max(0, counts.total - counts.done),
              })}
            </p>
          )}
        </div>
      )}

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-foreground text-sm">
            {t('scheduleSend.savedNotice')}
          </p>
          <Button
            onClick={onOpenSaved}
            className="h-auto min-h-10 px-5 py-2 whitespace-normal"
          >
            {t('scheduleSend.openSaved')}
          </Button>
        </div>
      )}

      <div className="border-border bg-background sticky bottom-0 z-10 flex flex-col gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing || locked}
          className="h-10 px-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing || locked}
              className="h-auto min-h-10 px-4 py-2 whitespace-normal"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => setShowSchedule(true)}
            disabled={
              !name.trim() ||
              isProcessing ||
              locked ||
              loadingReach ||
              reach === 0
            }
            className="h-auto min-h-10 px-4 py-2 whitespace-normal"
          >
            <CalendarClock className="h-4 w-4" />
            {t('scheduleSend.schedule')}
          </Button>
          <ScheduleDialog
            open={showSchedule}
            onOpenChange={setShowSchedule}
            title={t('scheduleSend.scheduleTitle')}
            description={t('scheduleSend.scheduleDesc')}
            confirmLabel={t('scheduleSend.scheduleConfirm', { count: reach })}
            onConfirm={(iso) => {
              setShowSchedule(false);
              setPendingSchedule(iso);
              setShowConfirm(true);
            }}
          />

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              onClick={() => setPendingSchedule(null)}
              render={
                <Button
                  disabled={
                    !name.trim() ||
                    isProcessing ||
                    locked ||
                    loadingReach ||
                    reach === 0
                  }
                  className="col-span-2 h-auto min-h-10 px-5 py-2 whitespace-normal sm:col-span-1"
                />
              }
            >
              <Send className="h-4 w-4" />
              {t('scheduleSend.sendNow')}
            </DialogTrigger>
            <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>[data-slot=dialog-close]]:size-10">
              <DialogHeader className="border-border shrink-0 border-b px-5 py-5 pr-14">
                <DialogTitle className="text-popover-foreground">
                  {pendingSchedule
                    ? t('scheduleSend.scheduleTitle')
                    : t('scheduleSend.confirmTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t('scheduleSend.confirmDesc')}
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-sm">
                {pendingSchedule && (
                  <p className="text-popover-foreground font-medium">
                    {formatScheduledAt(pendingSchedule)}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      {t('scheduleSend.broadcastName')}
                    </p>
                    <p className="text-popover-foreground break-words">
                      {name}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      {t('scheduleSend.template')}
                    </p>
                    <p className="text-popover-foreground break-words">
                      {template.name} · {template.language ?? 'en_US'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      {t('scheduleSend.audience')}
                    </p>
                    {audienceBlock}
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t('scheduleSend.recipients')}
                    </p>
                    <p className="text-popover-foreground font-medium">
                      {t('scheduleSend.recipientCount', { count: reach })}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                      {t('scheduleSend.messagePreview')} ({previewLabel})
                    </p>
                    <FormattingToggle
                      checked={formatted}
                      onCheckedChange={setFormatted}
                    />
                  </div>
                  <BroadcastMessagePreview
                    template={template}
                    bodyText={previewBody}
                    headerText={previewHeader}
                    buttonParams={previewButtons}
                    mediaUrl={headerMediaUrl}
                    formatted={formatted}
                  />
                </div>
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                  {t('scheduleSend.cannotUndo')}
                </p>
              </div>

              <DialogFooter className="mx-0 mb-0 shrink-0 flex-col px-5 py-4 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="h-10 px-4"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    if (pendingSchedule) onSchedule(pendingSchedule);
                    else onSend();
                  }}
                  className="h-auto min-h-10 px-5 py-2 whitespace-normal"
                >
                  {pendingSchedule ? (
                    <CalendarClock className="size-4" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {pendingSchedule
                    ? t('scheduleSend.scheduleConfirm', { count: reach })
                    : t('scheduleSend.sendTo', { count: reach })}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
