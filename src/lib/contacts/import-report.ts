/** What happened to each row of a contacts import, for the result report. */

export type SkipReason =
  | 'file_duplicate' // same number appeared earlier in the file
  | 'no_phone' // no usable number in the row
  | 'nothing_new' // already saved, and the row adds nothing
  | 'already_exists'; // the database rejected it as a duplicate

export interface ReportRow {
  phone: string;
  name?: string;
  /** Updated rows: the name change, when the file renamed the contact. */
  rename?: { from: string | null; to: string };
  /** Updated rows: tags the file carried for this contact. */
  tags?: string[];
  /** Skipped rows: why. */
  reason?: SkipReason;
  /** Failed rows: the error. */
  error?: string;
}

export interface ImportReport {
  imported: ReportRow[];
  updated: ReportRow[];
  skipped: ReportRow[];
  failed: ReportRow[];
  /** Tag names from the file that couldn't be created (not an admin). */
  skippedTags: string[];
}

export function emptyReport(): ImportReport {
  return { imported: [], updated: [], skipped: [], failed: [], skippedTags: [] };
}
