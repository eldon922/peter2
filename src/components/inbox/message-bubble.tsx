'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Message, MessageReaction } from '@/types';
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { ReplyQuote } from './reply-quote';
import { FormattedText } from './formatted-text';
import { ImageViewer } from './image-viewer';
import { MediaDownload } from './media-download';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  getMediaObjectUrl,
  peekMediaObjectUrl,
  releaseMediaObjectUrl,
} from '@/lib/inbox/media-cache';
import { MessageReactions } from './message-reactions';
import { InteractivePreview } from '@/components/interactive/interactive-preview';
import { useTranslations } from 'next-intl';

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock className="text-muted-foreground h-3 w-3" />;
    case 'sent':
      return <Check className="text-muted-foreground h-3 w-3" />;
    case 'delivered':
      return <CheckCheck className="text-muted-foreground h-3 w-3" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

/** Marks a message that was sent from a template (e.g. a broadcast). */
function TemplateBadge({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <span className="bg-primary/20 text-primary mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium">
      <LayoutTemplate className="h-3 w-3" />
      {t('template')}
    </span>
  );
}

/**
 * "Edited" marker for a message the customer changed. With earlier
 * versions on record it opens a list of them; the invisible spacer copy
 * of the timestamp row passes no history so it renders plain text of the
 * same width.
 */
function EditedLabel({
  history,
  className,
}: {
  history: { text: string | null; at: string }[];
  className?: string;
}) {
  const t = useTranslations('Inbox.bubble');
  const label = 'text-[10px] italic leading-none';
  if (history.length === 0) {
    return <span className={cn(label, className)}>{t('edited')}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          label,
          'underline decoration-dotted underline-offset-2',
          className
        )}
      >
        {t('edited')}
      </PopoverTrigger>
      <PopoverContent className="text-popover-foreground w-64 gap-2 p-3">
        <p className="text-xs font-medium">{t('previousVersions')}</p>
        <ul className="space-y-2">
          {[...history].reverse().map((h, i) => (
            <li key={i} className="bg-muted rounded-md px-2 py-1.5">
              <p className="text-xs wrap-anywhere whitespace-pre-wrap">
                {h.text ? <FormattedText text={h.text} /> : t('noText')}
              </p>
              <p className="text-muted-foreground mt-1 text-[10px]">
                {format(new Date(h.at), 'MMM d, HH:mm')}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function MediaUnavailable({
  label,
  t,
}: {
  label: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
      <ImageOff className="text-muted-foreground h-4 w-4 shrink-0" />
      <span>{t('unavailable', { label })}</span>
    </div>
  );
}

function MediaImage({
  url,
  alt,
  filename,
}: {
  url: string;
  alt: string;
  filename?: string | null;
}) {
  // Proxy URLs need the session, so they go through the shared media cache.
  const isProxy = url.startsWith('/api/whatsapp/media/');
  const [loaded, setLoaded] = useState<{
    url: string;
    src: string | null;
  } | null>(null);
  const [imgError, setImgError] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const t = useTranslations('Inbox.bubble');

  useEffect(() => {
    if (!isProxy) return;
    let cancelled = false;
    getMediaObjectUrl(url)
      .then((src) => !cancelled && setLoaded({ url, src }))
      .catch(() => !cancelled && setLoaded({ url, src: null }));
    return () => {
      cancelled = true;
      releaseMediaObjectUrl(url);
    };
  }, [url, isProxy]);

  const current = loaded?.url === url ? loaded : null;
  const src = isProxy ? (peekMediaObjectUrl(url) ?? current?.src ?? null) : url;
  const failed =
    imgError || (isProxy && current !== null && current.src === null);

  if (failed) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <ImageOff className="text-muted-foreground h-8 w-8" />
      </div>
    );
  }

  if (!src) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        aria-label={t('openImage')}
        title={t('openImage')}
        className="block cursor-zoom-in"
      >
        <img
          src={src}
          alt={alt}
          className="h-auto max-h-96 w-auto max-w-full rounded-lg object-contain"
          onError={() => setImgError(true)}
        />
      </button>
      <ImageViewer
        src={src}
        alt={alt}
        filename={filename}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </>
  );
}

/**
 * True when the bubble's content ends in a run of flowing text, i.e. the
 * cases where the timestamp can sit on the last line the way WhatsApp
 * places it. Media without a caption, documents and locations end in a
 * fixed-size block instead, so those keep the timestamp on its own row.
 */
function endsInText(message: Message): boolean {
  switch (message.content_type) {
    case 'text':
      return true;
    case 'image':
    case 'video':
    case 'template':
      return Boolean(message.content_text);
    case 'document':
      return Boolean(message.template_name && message.content_text);
    case 'interactive':
      return !message.interactive_payload;
    case 'audio':
    case 'location':
      return false;
    default:
      return true;
  }
}

function MessageContent({
  message,
  t,
  trailing,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  /**
   * Invisible copy of the timestamp row, appended inside the final text
   * paragraph so the last line reserves exactly the space the absolutely
   * positioned meta occupies. Only supplied when `endsInText(message)`.
   */
  trailing?: ReactNode;
}) {
  switch (message.content_type) {
    case 'text':
      return (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">
          <FormattedText text={message.content_text ?? ''} />
          {trailing}
        </p>
      );

    case 'image':
      return (
        <div>
          {message.template_name && <TemplateBadge t={t} />}
          {message.media_url ? (
            <MediaImage
              url={message.media_url}
              alt="Shared image"
              filename={message.media_filename}
            />
          ) : (
            <MediaUnavailable label={t('photo')} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap">
              <FormattedText text={message.content_text ?? ''} />
              {trailing}
            </p>
          )}
        </div>
      );

    case 'video':
      return (
        <div>
          {message.template_name && <TemplateBadge t={t} />}
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label={t('video')} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap">
              <FormattedText text={message.content_text ?? ''} />
              {trailing}
            </p>
          )}
        </div>
      );

    case 'audio':
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t('audio')} t={t} />
          )}
        </div>
      );

    case 'document': {
      // A template's body is its caption, not the file name.
      const fromTemplate = Boolean(message.template_name);
      const fileLabel =
        message.media_filename ||
        (fromTemplate ? t('document') : message.content_text || t('document'));
      return (
        <div>
          {fromTemplate && <TemplateBadge t={t} />}
          {message.media_url ? (
            <MediaDownload
              url={message.media_url}
              filename={message.media_filename || fileLabel}
            >
              <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
              <span className="truncate">{fileLabel}</span>
            </MediaDownload>
          ) : (
            <MediaUnavailable label={fileLabel} t={t} />
          )}
          {fromTemplate && message.content_text && (
            <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap">
              <FormattedText text={message.content_text} />
              {trailing}
            </p>
          )}
        </div>
      );
    }

    case 'template':
      return (
        <div>
          <TemplateBadge t={t} />
          {message.content_text && (
            <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap">
              <FormattedText text={message.content_text ?? ''} />
              {trailing}
            </p>
          )}
        </div>
      );

    case 'location':
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || t('locationShared')}</span>
        </div>
      );

    case 'interactive': {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === 'customer') {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
              <CornerDownLeft className="h-3 w-3" />
              {t('buttonReply')}
            </span>
            <p className="text-sm wrap-anywhere whitespace-pre-wrap">
              <FormattedText
                text={message.content_text || t('interactiveReply')}
              />
              {trailing}
            </p>
          </div>
        );
      }
      return (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">
          <FormattedText text={message.content_text || t('interactiveReply')} />
          {trailing}
        </p>
      );
    }

    default:
      return (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">
          <FormattedText text={message.content_text || t('unsupported')} />
          {trailing}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const t = useTranslations('Inbox.bubble');

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const time = format(new Date(message.created_at), 'HH:mm');

  // Timestamp + delivery ticks, as WhatsApp lays them out: tucked into
  // the bottom-right corner of the bubble, sharing the last line of text
  // when it fits and dropping to a line of their own when it doesn't.
  //
  // That needs the row rendered twice. The visible copy is positioned
  // absolutely in the corner (so it never pushes the bubble taller than
  // the text needs); an invisible copy rides at the end of the final
  // paragraph purely to reserve the matching run of inline space, which
  // is what makes the text wrap around it. Rendering the same markup for
  // both means the reservation is exact without measuring anything.
  const renderMeta = (interactive: boolean) => (
    <span className="inline-flex items-center gap-1 align-bottom">
      {/* AI badge — only on replies the auto-reply bot generated
          (always outbound, so it sits on the primary fill). Lets
          agents tell an AI reply from their own / a Flow's at a
          glance. */}
      {message.ai_generated && (
        <span
          className="bg-primary-foreground/20 text-primary-foreground inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] leading-none font-semibold tracking-wide uppercase"
          title={t('aiBadgeTitle')}
        >
          <Sparkles className="h-2.5 w-2.5" />
          {t('aiBadge')}
        </span>
      )}
      {message.edited_at && (
        <EditedLabel
          history={interactive ? (message.edit_history ?? []) : []}
          className={
            isAgent ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }
        />
      )}
      <span
        className={cn(
          'text-[10px] leading-none',
          // Outbound bubbles sit on the primary fill, so the
          // timestamp must read against that (not the neutral
          // foreground) — otherwise it goes low-contrast in light
          // mode. Inbound bubbles use the muted surface.
          isAgent ? 'text-primary-foreground/70' : 'text-muted-foreground'
        )}
      >
        {time}
      </span>
      {isAgent && <StatusIcon status={message.status} />}
    </span>
  );

  const inlineMeta = endsInText(message);

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'relative rounded-2xl px-3 py-2',
          isAgent
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted text-foreground rounded-bl-md'
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent
          message={message}
          t={t}
          trailing={
            inlineMeta ? (
              <span aria-hidden className="invisible inline-block pl-2">
                {renderMeta(false)}
              </span>
            ) : undefined
          }
        />
        {message.media_url &&
          ['image', 'video', 'audio'].includes(message.content_type) && (
            <MediaDownload
              url={message.media_url}
              filename={message.media_filename}
            />
          )}
        {inlineMeta ? (
          <span className="absolute right-3 bottom-2">{renderMeta(true)}</span>
        ) : (
          <div className="mt-1 flex justify-end">{renderMeta(true)}</div>
        )}
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
