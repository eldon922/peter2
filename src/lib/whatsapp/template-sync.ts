function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value ?? null;
}

export function templateSyncChanged(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  return Object.entries(incoming).some(([key, value]) =>
    !['user_id', 'account_id', 'updated_at'].includes(key) && JSON.stringify(canonical(existing[key])) !== JSON.stringify(canonical(value)),
  );
}
