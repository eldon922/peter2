// Passphrase generator, ported from Bitwarden's Rust implementation:
// https://github.com/bitwarden/sdk-internal/blob/main/crates/bitwarden-generators/src/passphrase.rs
//
// Behavioural parity with the Rust source:
//  - `num_words` words are drawn independently (with replacement) from
//    the EFF long wordlist, skipping entries that contain a hyphen
//    (pre-filtered in `eff-wordlist.ts`, see the comment there).
//  - If `includeNumber`, a single random digit (0-9) is appended to one
//    randomly chosen word.
//  - If `capitalize`, every word's first character is upper-cased.
//  - The words are joined with `wordSeparator` (may be empty, multiple
//    characters, or even an emoji — no validation is applied to it,
//    matching the Rust struct).
//
// Randomness: the Rust version uses `rand::rng()`, a CSPRNG. We use
// Node's `crypto.randomInt`, which is likewise a CSPRNG, instead of
// `Math.random()`.

import { randomInt } from "node:crypto";
import { EFF_LONG_WORD_LIST } from "./eff-wordlist";

/** Minimum number of words allowed in a generated passphrase. */
export const MINIMUM_PASSPHRASE_NUM_WORDS = 3;
/** Maximum number of words allowed in a generated passphrase. */
export const MAXIMUM_PASSPHRASE_NUM_WORDS = 20;

export interface PassphraseGeneratorRequest {
  /** Number of words in the generated passphrase. Must be between
   *  MINIMUM_PASSPHRASE_NUM_WORDS and MAXIMUM_PASSPHRASE_NUM_WORDS. */
  numWords: number;
  /** Character separator between words. May be empty. */
  wordSeparator: string;
  /** Capitalize the first letter of each word. */
  capitalize: boolean;
  /** Append a random digit to the end of one of the words. */
  includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE_REQUEST: PassphraseGeneratorRequest = {
  numWords: 3,
  wordSeparator: " ",
  capitalize: false,
  includeNumber: false,
};

export class PassphraseError extends Error {}

function validateOptions(
  request: PassphraseGeneratorRequest,
): asserts request is PassphraseGeneratorRequest {
  if (
    !Number.isInteger(request.numWords) ||
    request.numWords < MINIMUM_PASSPHRASE_NUM_WORDS ||
    request.numWords > MAXIMUM_PASSPHRASE_NUM_WORDS
  ) {
    throw new PassphraseError(
      `'numWords' must be between ${MINIMUM_PASSPHRASE_NUM_WORDS} and ${MAXIMUM_PASSPHRASE_NUM_WORDS}`,
    );
  }
}

function genWords(numWords: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < numWords; i++) {
    const idx = randomInt(0, EFF_LONG_WORD_LIST.length);
    words.push(EFF_LONG_WORD_LIST[idx]);
  }
  return words;
}

function includeNumberInWords(words: string[]): void {
  const numberIdx = randomInt(0, words.length);
  const digit = randomInt(0, 10);
  words[numberIdx] = `${words[numberIdx]}${digit}`;
}

function capitalizeFirstLetter(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function capitalizeWords(words: string[]): string[] {
  return words.map(capitalizeFirstLetter);
}

/** Generates a random passphrase, e.g. "Crust-Substance-Undertook-Protector2". */
export function generatePassphrase(
  request: PassphraseGeneratorRequest = DEFAULT_PASSPHRASE_REQUEST,
): string {
  validateOptions(request);

  let words = genWords(request.numWords);

  if (request.includeNumber) {
    includeNumberInWords(words);
  }

  if (request.capitalize) {
    words = capitalizeWords(words);
  }

  return words.join(request.wordSeparator);
}
