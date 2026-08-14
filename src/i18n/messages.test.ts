import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Locale dictionaries are hand-maintained. English is the source of
// truth (src/i18n/request.ts falls back to en.json only when a whole
// locale file is missing — there is no per-key fallback), so a key
// that lands in en.json and not in a translation renders as a raw
// keypath for users on that locale. This guards the parity.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';
const TRANSLATED_LOCALES = ['ko', 'id'];

function loadEntries(locale: string): [string, unknown][] {
  const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
  const out: [string, unknown][] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    out.push([path, node]);
  };
  walk(JSON.parse(raw), '');
  return out;
}

function loadKeys(locale: string): Set<string> {
  return new Set(loadEntries(locale).map(([path]) => path));
}

describe('message catalogue parity', () => {
  const source = loadKeys(SOURCE_LOCALE);

  it.each(TRANSLATED_LOCALES)('%s.json covers every en.json key', (locale) => {
    const translated = loadKeys(locale);
    const missing = [...source].filter((k) => !translated.has(k)).sort();
    expect(missing, `${locale}.json is missing these keys`).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)('%s.json has no orphaned keys', (locale) => {
    const translated = loadKeys(locale);
    const orphaned = [...translated].filter((k) => !source.has(k)).sort();
    expect(orphaned, `${locale}.json has keys absent from en.json`).toEqual([]);
  });
});

// next-intl parses every message as ICU, and an ICU tag may only be a
// bare identifier — `<strong>`, never `<strong class="…">`. An attribute
// makes the message unparseable, and next-intl throws INVALID_TAG at the
// t() call rather than rendering anything, so a single bad string takes
// out the whole component that reads it.
//
// The fix is always the same: keep the bare tag in the message and supply
// the styling from the component via t.rich() / t.markup(). Five setup-
// guide strings shipped with `class="text-foreground"` baked in and blew
// up the WhatsApp settings page the moment their accordion was expanded.
const TAG_WITH_ATTRIBUTES = /<[a-zA-Z][a-zA-Z0-9]*\s+[^<>]*=[^<>]*>/;

describe('message catalogue ICU validity', () => {
  it.each([SOURCE_LOCALE, ...TRANSLATED_LOCALES])(
    '%s.json has no tags carrying attributes',
    (locale) => {
      const offenders = loadEntries(locale)
        .filter(
          ([, value]) =>
            typeof value === 'string' && TAG_WITH_ATTRIBUTES.test(value),
        )
        .map(([path]) => path)
        .sort();
      expect(
        offenders,
        `${locale}.json: these messages have HTML attributes inside an ICU tag, ` +
          'which throws INVALID_TAG at render. Move the styling into the ' +
          'component and leave a bare tag in the message.',
      ).toEqual([]);
    },
  );
});
