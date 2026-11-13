'use client';
import type { CsvAudienceContact } from '@/lib/broadcasts/audience';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import {
  NO_HEADER_MEDIA,
  type HeaderMedia,
} from '@/lib/broadcasts/header-media';
import {
  defaultHeaderMedia,
  whatChangingTemplateClears,
} from '@/lib/broadcasts/template-change';
import { useLeaveGuard } from '@/hooks/use-leave-guard';
import { formatScheduledAt } from '@/lib/broadcasts/schedule';
import { BroadcastSavedError } from '@/lib/broadcasts/finish-broadcast';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

const steps = [
  { label: 'template', key: 'template' },
  { label: 'audience', key: 'audience' },
  { label: 'personalize', key: 'personalize' },
  { label: 'send', key: 'send' },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.new');
  const { accountId, canSendMessages, profileLoading } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress, stage, counts } =
    useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const stepTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = stepTopRef.current?.closest('main');
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentStep]);
  const [highestStep, setHighestStep] = useState(0);
  const [audienceValid, setAudienceValid] = useState(false);
  const [personalizationValid, setPersonalizationValid] = useState(false);
  function nextStep(index: number) {
    setHighestStep((previous) => Math.max(previous, index));
    setCurrentStep(index);
  }
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: CsvAudienceContact[];
    excludeTagIds?: string[];
  }>({ type: 'tags' });
  const [variables, setVariables] = useState<
    Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>
  >({});
  const [headerMedia, setHeaderMedia] = useState<HeaderMedia>(NO_HEADER_MEDIA);
  const [name, setName] = useState('');

  // Anything chosen so far would be lost by leaving; ask first.
  const { release, confirmLeave } = useLeaveGuard(
    template !== null || name.trim() !== '',
    t('leaveConfirm')
  );

  // Viewers are read-only — send them back to the list.
  useEffect(() => {
    if (!profileLoading && !canSendMessages) router.replace('/broadcasts');
  }, [profileLoading, canSendMessages, router]);

  // The variable values and the image belong to the template they were set for.
  function selectTemplate(next: MessageTemplate) {
    if (next.id !== template?.id) {
      const clears = whatChangingTemplateClears(
        template,
        variables,
        headerMedia
      );
      if (
        clears &&
        !window.confirm(t('changeTemplateConfirm', { items: clears }))
      )
        return;
      setHighestStep((previous) => Math.min(previous, 1));
      setPersonalizationValid(false);
      setVariables({});
      setHeaderMedia(defaultHeaderMedia(next));
    }
    setTemplate(next);
  }

  // A double click on a confirm button must not create the broadcast twice.
  const submitted = useRef(false);
  // Set when the last step failed after the broadcast was saved. It may have
  // started, so the buttons stay locked and the way out is to open it.
  const [savedId, setSavedId] = useState<string | null>(null);

  /** Sends now, or saves the broadcast to go out at `scheduledAt` (ISO). */
  async function handleSend(scheduledAt?: string) {
    if (!template || submitted.current) return;
    submitted.current = true;

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variables,
        headerMediaUrl: headerMedia.url,
        headerMediaId: headerMedia.mediaId,
        scheduledAt,
      });
      await release();
      if (scheduledAt) {
        toast.success(
          t('toastScheduled', { time: formatScheduledAt(scheduledAt) })
        );
      }
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      if (err instanceof BroadcastSavedError) {
        setSavedId(err.broadcastId);
        toast.error(err.message);
        return;
      }
      submitted.current = false;
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Broadcast failed';
      console.error('Broadcast failed:', err);
      toast.error(message);
    }
  }

  /**
   * Writes a draft broadcast row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later. We
   * don't persist the in-progress audience/variable config here
   * because the current schema doesn't carry it past `audience_filter`
   * and `template_variables`; those are enough for the user to
   * recognize the draft but not to exactly round-trip into the wizard.
   * A full resume-draft UX is a future polish.
   */
  async function handleSaveDraft() {
    if (!template || !name.trim()) {
      toast.error(t('toastGiveName'));
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(t('toastNotSignedIn'));
      return;
    }
    if (!accountId) {
      toast.error(t('toastNotLinked'));
      return;
    }

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'en_US',
      template_variables: variables,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(t('toastFailedDraft', { error: error.message }));
      return;
    }
    toast.success(t('toastDraftSaved'));
    await release();
    router.push('/broadcasts');
  }

  async function openSaved() {
    await release();
    router.push(`/broadcasts/${savedId}`);
  }

  async function handleLeave() {
    if (!confirmLeave()) return;
    await release();
    router.push('/broadcasts');
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col gap-6 sm:gap-8">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      {/* Step Indicator */}
      <ol aria-label={t('title')} className="grid grid-cols-4 gap-2 sm:gap-4">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <li
              key={step.key}
              className={`flex min-w-0 flex-col gap-2 border-b-2 ${isActive || isCompleted ? 'border-primary' : 'border-border'}`}
            >
              <button
                type="button"
                aria-current={isActive ? 'step' : undefined}
                disabled={
                  isProcessing ||
                  Boolean(savedId) ||
                  index > highestStep ||
                  (index > currentStep &&
                    (!template ||
                      (index > 1 && !audienceValid) ||
                      (index > 2 && !personalizationValid)))
                }
                onClick={() => setCurrentStep(index)}
                className="focus-visible:ring-ring flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-md pb-3 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center"
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${isCompleted ? 'bg-primary text-primary-foreground' : isActive ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'}`}
                >
                  {isCompleted ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span
                  className={`min-w-0 text-xs font-medium break-words sm:text-sm ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {t(`steps.${step.label}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Step Content */}
      <div ref={stepTopRef} className="relative flex flex-1 flex-col">
        <div
          className="flex flex-1 flex-col transition-opacity duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ChooseTemplate
              selectedTemplate={template}
              onSelect={selectTemplate}
              onNext={() => nextStep(1)}
              onBack={handleLeave}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={(next) => {
                setAudienceValid(false);
                setAudience(next);
              }}
              onValidationChange={setAudienceValid}
              onNext={() => nextStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && template && (
            <Step3Personalize
              template={template}
              variables={variables}
              onUpdate={(next) => {
                setPersonalizationValid(false);
                setVariables(next);
              }}
              onValidationChange={setPersonalizationValid}
              headerMedia={headerMedia}
              onHeaderMediaChange={(next) => {
                setPersonalizationValid(false);
                setHeaderMedia(next);
              }}
              onNext={() => nextStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && template && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              template={template}
              audience={audience}
              variables={variables}
              headerMediaUrl={headerMedia.url}
              headerMediaId={headerMedia.mediaId}
              onSend={() => handleSend()}
              onSchedule={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(2)}
              savedBroadcastId={savedId}
              onOpenSaved={openSaved}
              isProcessing={isProcessing}
              progress={progress}
              stage={stage}
              counts={counts}
            />
          )}
        </div>
      </div>
    </div>
  );
}
