'use client';

import { useLinkStatus } from 'next/link';
import { Loader2, type LucideIcon } from 'lucide-react';

export function NavigationIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" />;
}
