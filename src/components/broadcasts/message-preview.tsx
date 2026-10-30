import { CheckCheck, FileIcon, ImageIcon } from 'lucide-react';
import { format } from 'date-fns';

import { FormattedText } from '@/components/inbox/formatted-text';
import { renderTemplateBody } from '@/lib/whatsapp/broadcast-message';
import type { MessageTemplate } from '@/types';

interface Props {
  template: MessageTemplate;
  /** Body with variables already substituted. */
  bodyText: string;
  headerText?: string;
  buttonParams?: Record<number, string>;
  /** Media header link, when one was set for this broadcast. */
  mediaUrl?: string;
  /** Render WhatsApp formatting (*bold*, _italic_…) in the body. Default on. */
  formatted?: boolean;
}

// WhatsApp's own surface colours (see step 3), not app tokens.
export function BroadcastMessagePreview({
  template,
  bodyText,
  headerText,
  buttonParams,
  mediaUrl,
  formatted = true,
}: Props) {
  const headerType = template.header_type;
  const imageSrc =
    headerType === 'image' ? mediaUrl || template.header_media_url : undefined;

  return (
    <div className="rounded-lg bg-[#EFEAE2] p-3 dark:bg-[#0B141A]">
      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#D9FDD3] px-3 py-2 shadow-sm dark:bg-[#005C4B]">
        {headerType === 'text' && template.header_content && (
          <p className="mb-1 text-sm font-semibold break-words text-[#111B21] dark:text-[#E9EDEF]">
            {headerText === undefined
              ? template.header_content
              : renderTemplateBody(template.header_content, [headerText])}
          </p>
        )}
        {headerType &&
          headerType !== 'text' &&
          (imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt=""
              className="mb-1.5 h-auto max-h-80 w-auto max-w-full rounded-md object-contain"
            />
          ) : (
            <div className="mb-1.5 flex h-20 items-center justify-center rounded-md bg-black/10 text-[#667781] dark:bg-white/10 dark:text-[#E9EDEF]/60">
              {headerType === 'image' ? (
                <ImageIcon className="h-6 w-6" />
              ) : (
                <FileIcon className="h-6 w-6" />
              )}
            </div>
          ))}
        <p className="text-sm break-words whitespace-pre-wrap text-[#111B21] dark:text-[#E9EDEF]">
          {formatted ? <FormattedText text={bodyText} /> : bodyText}
        </p>
        {template.footer_text && (
          <p className="mt-1 text-xs break-words text-[#667781] dark:text-[#E9EDEF]/60">
            {template.footer_text}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[10px] text-[#667781] dark:text-[#E9EDEF]/60">
            {format(new Date(), 'HH:mm')}
          </span>
          <CheckCheck className="h-3 w-3 text-[#53BDEB]" />
        </div>
      </div>
      {template.buttons && template.buttons.length > 0 && (
        <div className="mt-1 ml-auto flex max-w-[85%] flex-col gap-1">
          {template.buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-lg bg-[#D9FDD3] px-3 py-1.5 text-center text-sm font-medium text-[#027EB5] shadow-sm dark:bg-[#005C4B] dark:text-[#53BDEB]"
            >
              {b.text}
              {b.type === 'URL' && (
                <p className="mt-0.5 text-xs font-normal break-all">
                  {renderTemplateBody(
                    b.url,
                    buttonParams?.[i] === undefined ? [] : [buttonParams[i]]
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
