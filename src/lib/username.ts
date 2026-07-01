// ============================================================
// Shared helper for deriving a display "username" from an email
// address (the part before the `@`). Compute this ONCE, at the
// point a profile/member row is loaded, and store it on the
// object — don't re-split the email in every component that
// wants to display it.
// ============================================================

export function getUsernameFromEmail(
  email: string | null | undefined,
): string {
  if (!email) return "";
  const [local] = email.split("@");
  return local ?? "";
}
