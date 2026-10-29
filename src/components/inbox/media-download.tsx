'use client';

import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { mediaDownloadName, saveMediaBlob } from '@/lib/inbox/download-media';

export function MediaDownload({ url, filename, children }: { url: string; filename?: string | null; children?: ReactNode }) {
  const t = useTranslations('Inbox.bubble');
  const [loading, setLoading] = useState(false);
  return <button type="button" disabled={loading} className="mt-1 flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50" onClick={async () => {
    setLoading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      saveMediaBlob(blob, mediaDownloadName(filename, url, blob.type));
    } catch { toast.error(t('downloadFailed')); }
    finally { setLoading(false); }
  }}>
    {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Download className="size-4 shrink-0" />}
    {children ?? t('download')}
  </button>;
}
