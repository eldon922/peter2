'use client';

import { useEffect, useState } from 'react';
import { Check, FileIcon, ImageIcon, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { checkMediaFile, MEDIA_SPECS, type HeaderMediaKind } from '@/lib/media-specs';
import { headerMediaError, type HeaderMedia } from '@/lib/broadcasts/header-media';
import { uploadHeaderMedia } from '@/lib/broadcasts/upload-header-media';

interface Props {
  kind: HeaderMediaKind;
  value: HeaderMedia;
  onChange: (value: HeaderMedia) => void;
  /** The template's saved link, offered when switching to the link tab. */
  defaultUrl?: string | null;
  /** Called on Enter in the link field. */
  onSubmit?: () => void;
}

const tabClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;

/**
 * Pick the header media for a broadcast: upload a file, or paste a link.
 * Both end up as a Meta media id when sending, so the choice is only about
 * where the file comes from.
 */
export function HeaderMediaPicker({ kind, value, onChange, defaultUrl, onSubmit }: Props) {
  const t = useTranslations('Broadcasts.wizard.personalize');
  const [mode, setMode] = useState<'upload' | 'url'>(
    value.url && !value.mediaId ? 'url' : 'upload'
  );
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  // Free the preview's memory when it is replaced or the picker goes away.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function switchMode(next: 'upload' | 'url') {
    setMode(next);
    if (next === 'upload') {
      onChange({ mediaId: value.mediaId, url: '' });
    } else {
      setPreviewUrl('');
      setFileName('');
      onChange({ mediaId: '', url: value.url || defaultUrl || '' });
    }
  }

  async function handleFile(file: File) {
    const issue = checkMediaFile(kind, file);
    if (issue?.problem === 'type') {
      toast.error(t('toastInvalidMediaFile', { kind, types: issue.types }));
      return;
    }
    if (issue?.problem === 'size') {
      toast.error(t('toastMediaTooLarge', { size: issue.size, limit: issue.limit }));
      return;
    }

    setUploading(true);
    try {
      const mediaId = await uploadHeaderMedia(file, kind, t('toastUploadFailed'));
      setPreviewUrl(URL.createObjectURL(file));
      setFileName(file.name);
      onChange({ mediaId, url: '' });
      toast.success(t('toastUploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  const error = headerMediaError(value);
  const linkPreview = kind === 'image' && mode === 'url' && error === null && value.url.trim();

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-border bg-muted p-0.5">
        <button type="button" onClick={() => switchMode('upload')} className={tabClass(mode === 'upload')}>
          <Upload className="h-3.5 w-3.5" />
          {t('uploadTab')}
        </button>
        <button type="button" onClick={() => switchMode('url')} className={tabClass(mode === 'url')}>
          {t('urlTab')}
        </button>
      </div>

      {mode === 'upload' ? (
        <div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted">
            <input
              type="file"
              accept={MEDIA_SPECS[kind].mimeTypes.join(',')}
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : kind === 'image' ? (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            ) : (
              <FileIcon className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">
              {uploading ? t('uploading') : value.mediaId ? t('replaceFile') : t('chooseFile')}
            </span>
            <span className="text-xs text-muted-foreground">{t(`${kind}Hint`)}</span>
          </label>

          {value.mediaId && !uploading && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('uploadedReady', { name: fileName || kind })}</span>
            </div>
          )}

          {kind === 'image' && previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={t('preview')}
              className="mt-3 max-h-40 rounded-lg border border-border object-contain"
            />
          )}
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('imageUrl')}
          </label>
          <Input
            type="url"
            value={value.url}
            onChange={(e) => onChange({ mediaId: '', url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && error === null) onSubmit?.();
            }}
            placeholder={t('imageUrlPlaceholder')}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
          />
          {linkPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={linkPreview}
              alt={t('preview')}
              className="mt-3 max-h-40 rounded-lg border border-border object-contain"
            />
          )}
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-amber-300">
          {error === 'missing' ? t('headerMediaMissing') : t('headerMediaInvalid')}
        </p>
      )}
    </div>
  );
}
