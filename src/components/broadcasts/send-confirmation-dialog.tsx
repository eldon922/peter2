'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import type { Broadcast, BroadcastRecipient, MessageTemplate } from '@/types';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message';
import {
  resolveVariables,
  fetchCustomValueIndex,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BroadcastMessagePreview } from './message-preview';
import { PhoneCountryWarning } from '@/components/phone-country-warning';

export function SendConfirmationDialog({
  open,
  onOpenChange,
  broadcast,
  recipientId,
  retry = false,
  busy = false,
  title,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broadcast: Broadcast;
  recipientId?: string;
  retry?: boolean;
  busy?: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const t = useTranslations('Broadcasts.wizard');
  const [preview, setPreview] = useState<{
    template: MessageTemplate;
    body: string;
    headerText?: string;
    buttonParams?: Record<number, string>;
    count: number;
    phone: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setPreview(null);
      setFailed(false);
      const db = createClient();
      let query = db
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)', { count: 'exact' })
        .eq('broadcast_id', broadcast.id);
      if (recipientId) query = query.eq('id', recipientId);
      query = query.eq('status', retry ? 'failed' : 'pending');
      const [templateResult, recipientResult] = await Promise.all([
        db
          .from('message_templates')
          .select('*')
          .eq('name', broadcast.template_name)
          .eq('language', broadcast.template_language || 'en_US')
          .maybeSingle(),
        query.order('id').limit(1),
      ]);
      if (templateResult.error || recipientResult.error || !templateResult.data)
        throw new Error('preview unavailable');
      const template = templateResult.data as MessageTemplate;
      const recipient = recipientResult.data?.[0] as unknown as
        BroadcastRecipient | undefined;
      let values = Array.isArray(recipient?.template_params)
        ? (recipient.template_params as string[])
        : [];
      if (
        !values.length &&
        recipient?.contact &&
        broadcast.template_variables
      ) {
        const custom = await fetchCustomValueIndex(db, [recipient.contact.id]);
        values = resolveVariables(
          broadcast.template_variables as Record<string, VariableMapping>,
          recipient.contact,
          custom.get(recipient.contact.id)
        );
      }
      if (!cancelled)
        setPreview({
          template,
          body: renderTemplateBody(template.body_text, values) ?? '',
          headerText: recipient?.template_header_text ?? undefined,
          buttonParams: recipient?.template_button_params ?? undefined,
          count: recipientResult.count ?? 0,
          phone:
            recipient?.contact?.phone ?? recipient?.phone_attempted ?? null,
        });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    broadcast.id,
    broadcast.template_name,
    broadcast.template_language,
    broadcast.template_variables,
    recipientId,
    retry,
  ]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {broadcast.name} · {broadcast.template_name} ·{' '}
            {broadcast.template_language}
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t('scheduleSend.recipientCount', { count: preview.count })}
              {preview.phone ? ` · ${preview.phone}` : ''}
            </p>
            <BroadcastMessagePreview
              template={preview.template}
              bodyText={preview.body}
              headerText={preview.headerText}
              buttonParams={preview.buttonParams}
              mediaUrl={
                broadcast.header_media_url ||
                (broadcast.header_media_id
                  ? `/api/whatsapp/media/${broadcast.header_media_id}`
                  : undefined)
              }
            />
            <PhoneCountryWarning />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t('scheduleSend.cannotUndo')}
            </p>
          </div>
        ) : failed ? (
          <p role="alert" className="text-sm text-red-500">
            {t('scheduleSend.previewUnavailable')}
          </p>
        ) : (
          <Loader2 className="size-5 animate-spin" />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={busy || !preview || preview.count === 0}
            onClick={onConfirm}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
