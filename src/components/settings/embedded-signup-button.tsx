'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { Loader2, MessageCircle, Copy, Check, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/**
 * Meta Embedded Signup — the one-click alternative to pasting Cloud API
 * credentials by hand.
 *
 * Two flavours behind one button. `featureType:
 * 'whatsapp_business_app_onboarding'` is what adds the "connect the
 * WhatsApp Business app account you already have" screen (coexistence);
 * without it the popup only ever offers to provision a fresh Cloud API
 * number. Which one the customer picked is not something the browser
 * decides — the server reads `platform_type` off the number afterwards.
 *
 * This is the app's only third-party SDK embed, so the script is scoped
 * to this component rather than added to the root layout: an instance
 * without Embedded Signup configured never renders it and never loads
 * Facebook's SDK at all.
 */

/**
 * Both public vars are read as whole `process.env.X` expressions, never
 * destructured or dynamically indexed — Next inlines `NEXT_PUBLIC_*` at
 * build time by textual substitution, so anything cleverer resolves to
 * undefined in the browser bundle.
 */
const FB_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
const ES_CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;

/** Graph version for FB.init — kept in step with META_API_VERSION. */
const FB_SDK_VERSION = 'v21.0';

/** Origins Meta's signup popup posts its session info from. */
const META_MESSAGE_ORIGINS = [
  'https://www.facebook.com',
  'https://web.facebook.com',
];

/**
 * Completion events. `FINISH` is a plain Cloud API signup,
 * `FINISH_ONLY_WABA` completed without a phone number attached, and
 * `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` is the coexistence path. All
 * three are treated the same here: keep whatever session info arrived
 * and let the server fill in the rest.
 */
const FINISH_EVENTS = [
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
];

interface SessionInfo {
  waba_id?: string;
  phone_number_id?: string;
}

/** Minimal shape of the bits of the FB JS SDK we call. */
interface FacebookSdk {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    /**
     * The SDK calls this once it has finished setting itself up. This is
     * the documented hook — `window.FB` is not reliably populated at the
     * script tag's own load event, so initialising from there can no-op.
     */
    fbAsyncInit?: () => void;
  }
}

/** True only when this instance is actually set up for Embedded Signup. */
export function isEmbeddedSignupConfigured(): boolean {
  return Boolean(FB_APP_ID && ES_CONFIG_ID);
}

export function EmbeddedSignupButton({
  canEdit,
  onConnected,
}: {
  canEdit: boolean;
  /** Called after a successful connect so the panel can reload the row. */
  onConnected: () => void;
}) {
  const t = useTranslations('Settings.whatsapp.embeddedSignup');
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /** The one-time /register PIN, shown once and never persisted. */
  const [revealedPin, setRevealedPin] = useState<string | null>(null);
  /** Gates the dialog's close button — see the dialog JSX below. */
  const [pinSavedAck, setPinSavedAck] = useState(false);
  const [pinCopied, setPinCopied] = useState(false);

  /**
   * Session info arrives on a `message` event that races the `FB.login`
   * callback — a ref, not state, so the callback reads whatever landed
   * without depending on a re-render having happened first.
   */
  const sessionInfoRef = useRef<SessionInfo>({});
  /** Set when the customer closed or errored out of the popup. */
  const abortedRef = useRef<string | null>(null);
  /** FB.init is per page load, not per mount — don't run it twice. */
  const initialisedRef = useRef(false);

  /**
   * Initialise the SDK, once, and only once it is genuinely there.
   *
   * Returns false when `window.FB` is still absent, so callers can tell
   * "not ready yet" from "ready" instead of silently doing nothing — a
   * button that enables on a failed init is a button that looks broken.
   */
  const initSdk = useCallback((): boolean => {
    if (!window.FB) return false;
    if (!initialisedRef.current) {
      window.FB.init({
        appId: FB_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: FB_SDK_VERSION,
      });
      initialisedRef.current = true;
    }
    setSdkReady(true);
    return true;
  }, []);

  useEffect(() => {
    // Two orderings to cover, because the SDK script and this component
    // race each other:
    //
    //   - Script still loading → the SDK calls fbAsyncInit when ready.
    //   - Script already loaded (a remount, or a warm cache) →
    //     fbAsyncInit has already fired and will not fire again, so the
    //     Script's own onReady below does the honours instead. It runs
    //     on every mount, cached or not.
    window.fbAsyncInit = () => {
      initSdk();
    };

    return () => {
      // Leave FB itself alone — other mounts may still need it — but
      // don't leave a callback pointing at an unmounted component.
      window.fbAsyncInit = undefined;
    };
  }, [initSdk]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Origin check first, before touching the payload: without it any
      // frame on the page could hand us a WABA id to connect.
      if (!META_MESSAGE_ORIGINS.includes(event.origin)) return;

      let payload: { type?: string; event?: string; data?: SessionInfo };
      try {
        payload =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        // Facebook's SDK posts plenty of non-JSON chatter on these
        // origins; anything unparseable is simply not ours.
        return;
      }

      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (payload.event && FINISH_EVENTS.includes(payload.event)) {
        sessionInfoRef.current = {
          waba_id: payload.data?.waba_id,
          phone_number_id: payload.data?.phone_number_id,
        };
        abortedRef.current = null;
        return;
      }

      if (payload.event === 'CANCEL') {
        abortedRef.current = t('cancelled');
      } else if (payload.event === 'ERROR') {
        abortedRef.current = t('popupError');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [t]);

  /**
   * Finish the signup server-side once the popup has handed back a code.
   *
   * Split out of the FB.login callback deliberately — see the note there.
   * Never rejects: every path resolves, so `void`-ing the call is safe.
   */
  const completeSignup = useCallback(
    async (code: string) => {
      try {
        const res = await fetch('/api/whatsapp/embedded-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            // Both optional — the server re-derives anything the popup
            // didn't send.
            waba_id: sessionInfoRef.current.waba_id,
            phone_number_id: sessionInfoRef.current.phone_number_id,
          }),
        });
        const payload = await res.json();

        if (!res.ok) {
          toast.error(payload?.error ?? t('connectFailed'));
          return;
        }

        toast.success(
          payload.connection_type === 'coexistence'
            ? t('connectedCoexistence')
            : t('connected'),
        );
        // Credentials and subscription are valid either way — only the
        // /register call for inbound webhooks can fail here. Surface it
        // as a follow-up warning rather than blocking the success toast;
        // the settings panel's own "Not Registered" banner (driven by
        // the same registered_at / last_registration_error the manual
        // connect form uses) gives the retry path.
        if (payload.registration_error) {
          toast.warning(t('registeredFailedWarning', { error: payload.registration_error }));
        }
        // The PIN only ever arrives on THIS response, right after a
        // successful /register — it is never persisted server-side and
        // there is no "view it again" screen, so a toast (which the
        // customer can dismiss or miss entirely) is not enough. A
        // dialog gated on an explicit acknowledgement is deliberately
        // harder to blow past.
        if (payload.registration_pin) {
          setPinSavedAck(false);
          setPinCopied(false);
          setRevealedPin(payload.registration_pin);
        }
        onConnected();
      } catch (err) {
        console.error('[embedded-signup] connect failed:', err);
        toast.error(t('connectFailed'));
      } finally {
        setConnecting(false);
      }
    },
    [onConnected, t],
  );

  const handleLogin = useCallback(() => {
    // Reachable if the SDK was blocked between render and click (an ad
    // blocker, a dropped connection). Previously this returned silently
    // and the button just appeared dead.
    if (!window.FB || !ES_CONFIG_ID) {
      toast.error(t('sdkFailed'));
      return;
    }

    sessionInfoRef.current = {};
    abortedRef.current = null;
    setConnecting(true);

    window.FB.login(
      // MUST stay a plain function. The SDK type-checks this argument and
      // throws "Expression is of type asyncfunction, not function" on an
      // `async` one — the popup then completes but the callback never
      // runs, so nothing is ever saved. Hand the async work off instead.
      (response) => {
        const code = response?.authResponse?.code;

        if (!code) {
          // No code means the customer backed out, or the popup failed.
          // The message listener usually has the more specific reason.
          toast.error(abortedRef.current ?? t('cancelled'));
          setConnecting(false);
          return;
        }

        void completeSignup(code);
      },
      {
        config_id: ES_CONFIG_ID,
        // Embedded Signup hands back an exchangeable code rather than a
        // client-side token — the override is required, since the SDK's
        // default is still `token`.
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  }, [completeSignup, t]);

  const copyPin = useCallback(() => {
    if (!revealedPin) return;
    void navigator.clipboard.writeText(revealedPin).then(() => {
      setPinCopied(true);
    });
  }, [revealedPin]);

  if (!isEmbeddedSignupConfigured()) return null;

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          // Initialisation lives in the effect above, driven by
          // fbAsyncInit. onReady only nudges it for the cached-script
          // case, and does nothing when FB isn't actually there.
          onReady={() => {
            initSdk();
          }}
          onError={() => toast.error(t('sdkFailed'))}
        />
        <Button
          onClick={handleLogin}
          disabled={!canEdit || !sdkReady || connecting}
          className="w-full sm:w-auto"
        >
          {connecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MessageCircle className="size-4" />
          )}
          {connecting ? t('connecting') : t('connectButton')}
        </Button>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t('coexistenceHint')}
        </p>
      </CardContent>
    </Card>

    {/* One-time PIN reveal. Not dismissible via the primary action
        until the customer explicitly confirms they've saved it —
        this PIN is not recoverable from anywhere in this app once
        the dialog closes. Backdrop/Escape can still close it (base
        behaviour), so the checkbox gate is a strong nudge, not a
        hard trap — deliberately, since trapping a modal open is its
        own kind of bad UX. */}
    <Dialog
      open={revealedPin !== null}
      onOpenChange={(open) => {
        if (!open) setRevealedPin(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <ShieldAlert className="size-5 shrink-0" />
            {t('pinDialog.title')}
          </DialogTitle>
          <DialogDescription>{t('pinDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-950/20 px-4 py-3">
          <span className="flex-1 text-center font-mono text-2xl tracking-[0.4em] text-foreground">
            {revealedPin}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyPin}
            className="shrink-0"
          >
            {pinCopied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {pinCopied ? t('pinDialog.copied') : t('pinDialog.copy')}
          </Button>
        </div>

        <p className="text-xs text-amber-500/90 leading-relaxed">
          {t('pinDialog.warning')}
        </p>

        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={pinSavedAck}
            onCheckedChange={(checked) => setPinSavedAck(checked === true)}
            className="mt-0.5"
          />
          {t('pinDialog.ackLabel')}
        </label>

        <DialogFooter>
          <Button
            type="button"
            disabled={!pinSavedAck}
            onClick={() => setRevealedPin(null)}
          >
            {t('pinDialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
