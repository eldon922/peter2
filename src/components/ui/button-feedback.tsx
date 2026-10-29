'use client';

import { useRef, useState } from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ButtonFeedback({ onClick, children, className, disabled, ...props }: ButtonPrimitive.Props) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  return <ButtonPrimitive {...props} className={cn('relative', className)} disabled={disabled || pending} aria-busy={pending || props['aria-busy']} onClick={(event) => {
    if (inFlight.current) { event.preventDefault(); return; }
    const result = (onClick as ((event: unknown) => unknown) | undefined)?.(event);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      inFlight.current = true;
      setPending(true);
      return Promise.resolve(result).finally(() => { inFlight.current = false; setPending(false); });
    }
  }}>
    <span className={cn('inline-flex items-center justify-center [gap:inherit]', pending && 'invisible')}>{children}</span>
    {pending && <span aria-hidden className="absolute inset-0 flex items-center justify-center"><Loader2 className="size-4 animate-spin" /></span>}
  </ButtonPrimitive>;
}
