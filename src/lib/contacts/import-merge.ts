import { normalizeKey } from '@/lib/contacts/dedupe';
import type { ParsedContactRow } from '@/lib/contacts/parse-contact-csv';

/**
 * Deciding what an import does with each row.
 *
 * A phone number already on file used to be skipped outright, which threw
 * away the only new information the file carried. A re-export from
 * another system typically repeats existing contacts with fresh tags, or
 * with a name that was blank the first time round — dropping those rows
 * meant the import silently did nothing for most of the file.
 *
 * Pulled out of the modal because the rules are fiddly enough to be worth
 * testing on their own: which rows insert, which merge, what counts as a
 * rename, and which are genuinely nothing-to-do.
 */

/** The subset of an existing contact this decision needs. */
export interface ExistingContact {
  id: string;
  name: string | null;
}

export interface MergeTarget {
  row: ParsedContactRow;
  /** Existing contact id to write to. */
  id: string;
  /** New name to store, or null to leave the stored one alone. */
  rename: string | null;
}

export interface ImportPlan {
  /** Numbers this account has never seen. */
  toInsert: ParsedContactRow[];
  /** Numbers already on file that this row can add something to. */
  toMerge: MergeTarget[];
  /** Rows matching an existing contact with nothing new to contribute. */
  duplicates: number;
}

/**
 * Split parsed rows into inserts, merges and no-ops.
 *
 * A row merges when it carries anything the stored contact doesn't
 * already have:
 *
 *   - tags, which are additive — `assignImportedContactTags` upserts with
 *     ignoreDuplicates, so re-stating a tag the contact already has costs
 *     nothing and re-stating a new one adds it;
 *   - a name, which replaces the stored one — but **only when non-empty**.
 *     A file exported without a name column would otherwise blank out
 *     every name that had been filled in since, which is the one outcome
 *     an import must never produce. An identical name is not a rename.
 *
 * `existingByPhone` is keyed by `normalizeKey(phone)`, matching the
 * generated `phone_normalized` column (migration 022).
 */
export function planContactImport(
  rows: ParsedContactRow[],
  existingByPhone: Map<string, ExistingContact>
): ImportPlan {
  const toInsert: ParsedContactRow[] = [];
  const toMerge: MergeTarget[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const match = existingByPhone.get(normalizeKey(row.phone));
    if (!match) {
      toInsert.push(row);
      continue;
    }

    const incoming = (row.name ?? '').trim();
    const rename =
      incoming && incoming !== (match.name ?? '').trim() ? incoming : null;

    if (!rename && row.tagNames.length === 0) {
      duplicates++;
      continue;
    }

    toMerge.push({ row, id: match.id, rename });
  }

  return { toInsert, toMerge, duplicates };
}
