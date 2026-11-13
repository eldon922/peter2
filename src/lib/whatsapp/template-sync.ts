function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value ?? null;
}

function comparable(key: string, value: unknown): unknown {
  if (key === 'header_handle' && typeof value === 'string') {
    try {
      const url = new URL(value);
      // Meta rotates CDN signatures without changing the underlying sample media.
      if (
        url.hostname.endsWith('.fbcdn.net') ||
        url.hostname.endsWith('.fbsbx.com')
      ) {
        for (const key of [...url.searchParams.keys()])
          if (['oh', 'oe'].includes(key) || key.startsWith('_nc_'))
            url.searchParams.delete(key);
        return url.toString();
      }
    } catch {
      /* Opaque upload handles are compared verbatim. */
    }
  }
  if (
    ['buttons', 'sample_values'].includes(key) &&
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 0
  )
    return null;
  if (['header_content', 'footer_text'].includes(key) && value === '')
    return null;
  return canonical(value);
}

export function templateSyncChanged(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): boolean {
  return Object.entries(incoming).some(
    ([key, value]) =>
      !['user_id', 'account_id', 'updated_at'].includes(key) &&
      JSON.stringify(comparable(key, existing[key])) !==
        JSON.stringify(comparable(key, value))
  );
}
