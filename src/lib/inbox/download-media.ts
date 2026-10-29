export function mediaDownloadName(
  filename: string | null | undefined,
  url: string,
  mime: string
): string {
  if (filename?.trim()) return filename.trim().replace(/[/\\\x00-\x1f]/g, '_');
  const tail = decodeURIComponent(
    url.split('?')[0].split('/').pop() ?? ''
  ).replace(/^\d+-/, '');
  if (/\.[a-z0-9]{1,8}$/i.test(tail)) return tail;
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
  };
  return `attachment.${extensions[mime.split(';')[0]] ?? 'bin'}`;
}

export function saveMediaBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
