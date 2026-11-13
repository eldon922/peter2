'use client';
import { useRef, useState, type ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react';
import { Textarea } from './textarea';
import { Button } from './button';
import {
  toggleFormat,
  clipboardText,
  selectionPosition,
} from '@/lib/editor/formatting';

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};
export function FormattedTextarea({ value, onValueChange, ...props }: Props) {
  const t = useTranslations('Inbox.composer');
  const editor = useRef<HTMLTextAreaElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  function format(marker: string) {
    if (!editor.current) return;
    const next = toggleFormat(
      value,
      editor.current.selectionStart,
      editor.current.selectionEnd,
      marker
    );
    if (props.maxLength && next.text.length > props.maxLength) return;
    onValueChange(next.text);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(next.start, next.end);
    });
  }
  return (
    <div ref={container} className="relative">
      <Textarea
        {...props}
        ref={editor}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onSelect={(event) => {
          if (
            event.currentTarget.selectionStart ===
            event.currentTarget.selectionEnd
          ) {
            setPosition(null);
            return;
          }
          const point = selectionPosition(event.currentTarget);
          const bounds = container.current?.getBoundingClientRect();
          setPosition({
            left: point.left - (bounds?.left ?? 0),
            top: point.top - (bounds?.top ?? 0),
          });
        }}
        onScroll={() => setPosition(null)}
        onBlur={(event) => {
          if (!toolbar.current?.contains(event.relatedTarget as Node))
            setPosition(null);
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            ['b', 'i'].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            format(event.key.toLowerCase() === 'b' ? '*' : '_');
          }
          if (event.key === 'Escape') setPosition(null);
        }}
        onPaste={(event) => {
          const text = clipboardText(event.clipboardData);
          if (!text) return;
          event.preventDefault();
          const field = event.currentTarget;
          const start = field.selectionStart;
          const capacity = props.maxLength
            ? Math.max(
                0,
                props.maxLength - value.length + field.selectionEnd - start
              )
            : text.length;
          const pasted = text.slice(0, capacity);
          onValueChange(
            value.slice(0, start) + pasted + value.slice(field.selectionEnd)
          );
          requestAnimationFrame(() =>
            field.setSelectionRange(
              start + pasted.length,
              start + pasted.length
            )
          );
        }}
      />
      {position && !props.disabled && !props.readOnly && (
        <div
          ref={toolbar}
          role="toolbar"
          aria-label={t('formatting')}
          style={position}
          className="bg-popover text-popover-foreground absolute z-[100] flex gap-1 rounded-lg border p-1 shadow-lg"
        >
          {[
            { marker: '*', label: 'bold', Icon: Bold },
            { marker: '_', label: 'italic', Icon: Italic },
            { marker: '~', label: 'strike', Icon: Strikethrough },
            { marker: '```', label: 'code', Icon: Code },
            { marker: 'bullet', label: 'bulletList', Icon: List },
            { marker: 'numbered', label: 'numberedList', Icon: ListOrdered },
            { marker: 'quote', label: 'quote', Icon: Quote },
          ].map(({ marker, label, Icon }) => (
            <Button
              key={label}
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t(label)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(marker)}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
