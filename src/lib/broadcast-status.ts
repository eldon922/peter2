/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Badge shape: bg-*-500/10 + text-*-400 + border-*-500/20. The
 * translucent fills sit fine on both light and dark surfaces; neutral
 * statuses use text-muted-foreground so the label stays legible in
 * light mode (a solid slate-400 would be too faint on white).
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "draft",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  scheduled: {
    label: "scheduled",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  sending: {
    label: "sending",
    classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    pulse: true,
  },
  sent: {
    label: "sent",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "pending",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  // These three match the funnel bars and stat cards on the broadcast
  // detail page step for step: sent = brand, delivered = green,
  // read = blue.
  sent: {
    label: "sent",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  delivered: {
    label: "delivered",
    classes: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  read: {
    label: "read",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  replied: {
    label: "replied",
    classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}

/**
 * Pulls the label colour out of a chip's `classes` so plain text can be
 * tinted to match the chip — the recipients table colours each timestamp
 * line after the status it belongs to.
 *
 * Reading it back off `classes` rather than storing a second copy keeps
 * one source of truth, and keeps the class name written out in full
 * where Tailwind can see it. Relies on the badge shape documented above:
 * exactly one `text-*` class per entry.
 */
export function statusTextClass(status: StatusDisplay): string {
  return status.classes.split(" ").find((c) => c.startsWith("text-")) ?? "";
}
