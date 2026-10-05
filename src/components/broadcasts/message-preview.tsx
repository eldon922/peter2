import { CheckCheck, FileIcon, ImageIcon } from 'lucide-react';
import { format } from 'date-fns';

import { FormattedText } from '@/components/inbox/formatted-text';
import type { MessageTemplate } from '@/types';

interface Props {
  template: MessageTemplate;
  /** Body with variables already substituted. */
  bodyText: string;
  /** Media header link, when one was set for this broadcast. */
  mediaUrl?: string;
  /** Render WhatsApp formatting (*bold*, _italic_…) in the body. Default on. */
  formatted?: boolean;
}

// WhatsApp's own surface colours (see step 3), not app tokens.
export function BroadcastMessagePreview({
  template,
  bodyText,
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
          <p className="mb-1 break-words text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
            {template.header_content}
          </p>
        )}
        {headerType && headerType !== 'text' && (
          imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt=""
              className="mb-1.5 max-h-40 w-full rounded-md object-cover"
            />
          ) : (
            <div className="mb-1.5 flex h-20 items-center justify-center rounded-md bg-black/10 text-[#667781] dark:bg-white/10 dark:text-[#E9EDEF]/60">
              {headerType === 'image' ? (
                <ImageIcon className="h-6 w-6" />
              ) : (
                <FileIcon className="h-6 w-6" />
              )}
            </div>
          )
        )}
        <p className="whitespace-pre-wrap break-words text-sm text-[#111B21] dark:text-[#E9EDEF]">
          {formatted ? <FormattedText text={bodyText} /> : bodyText}
        </p>
        {template.footer_text && (
          <p className="mt-1 break-words text-xs text-[#667781] dark:text-[#E9EDEF]/60">
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
        <div className="ml-auto mt-1 flex max-w-[85%] flex-col gap-1">
          {template.buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-lg bg-[#D9FDD3] px-3 py-1.5 text-center text-sm font-medium text-[#027EB5] shadow-sm dark:bg-[#005C4B] dark:text-[#53BDEB]"
            >
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
