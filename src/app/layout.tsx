import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Base URL that every URL-bearing metadata field (og:image, og:url,
// canonical) is resolved against. Next resolves relative metadata
// URLs against this at BUILD time — most pages here are statically
// prerendered, so there is no request to read a Host header from the
// way `/api/account/invitations` does.
//
// Without it Next falls back to `http://localhost:3000`, which is
// what shipped before: the `og:image` tag was present but pointed at
// localhost, so scrapers couldn't fetch it and fell back to inferring
// an image from the icon tags.
//
// `NEXT_PUBLIC_SITE_URL` is the same knob operators already set for
// invite links; `VERCEL_URL` covers preview/production deploys that
// haven't set it. The localhost fallback keeps `next dev` working.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

const TITLE = "Peter2";
const DESCRIPTION = "Self-hostable CRM template for WhatsApp.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s — ${TITLE}`,
  },
  description: DESCRIPTION,
  // og:image is also emitted by `app/opengraph-image.tsx` (Next's file
  // convention). It is repeated here explicitly so the property is
  // stated outright rather than left to be inferred, and so the URL is
  // an absolute one resolved from `metadataBase`.
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  robots: {
    index: false,
    follow: false,
  },
  // No `icons` entry: `app/favicon.ico` is picked up by Next's file
  // convention and emits its own <link rel="icon">. A hand-written
  // `{ icon: [{ url: "/icon" }] }` used to sit here, but there is no
  // `app/icon.*` route backing it, so it emitted a <link rel="icon">
  // pointing at a 404.
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
