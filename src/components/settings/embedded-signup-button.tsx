'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { Loader2, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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

  /**
   * Session info arrives on a `message` event that races the `FB.login`
   * callback — a ref, not state, so the callback reads whatever landed
   * without depending on a re-render having happened first.
   */
  const sessionInfoRef = useRef<SessionInfo>({});
  /** Set when the customer closed or errored out of the popup. */
  const abortedRef = useRef<string | null>(null);

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

  const handleLogin = useCallback(() => {
    if (!window.FB || !ES_CONFIG_ID) return;

    sessionInfoRef.current = {};
    abortedRef.current = null;
    setConnecting(true);

    window.FB.login(
      async (response) => {
        const code = response?.authResponse?.code;

        if (!code) {
          // No code means the customer backed out, or the popup failed.
          // The message listener usually has the more specific reason.
          toast.error(abortedRef.current ?? t('cancelled'));
          setConnecting(false);
          return;
        }

        try {
          const res = await fetch('/api/whatsapp/embedded-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              // Both optional — the server re-derives anything the
              // popup didn't send.
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
          onConnected();
        } catch (err) {
          console.error('[embedded-signup] connect failed:', err);
          toast.error(t('connectFailed'));
        } finally {
          setConnecting(false);
        }
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
  }, [onConnected, t]);

  if (!isEmbeddedSignupConfigured()) return null;

  return (
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
          onReady={() => {
            window.FB?.init({
              appId: FB_APP_ID,
              autoLogAppEvents: true,
              xfbml: false,
              version: FB_SDK_VERSION,
            });
            setSdkReady(true);
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
  );
}
