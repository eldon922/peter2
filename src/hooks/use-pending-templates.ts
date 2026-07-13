"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Count of templates awaiting Meta review for the current user. Used
 * by the sidebar to surface a badge on the Templates nav entry —
 * mirrors `useUnreadNotifications`.
 */
export function usePendingTemplates(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: pendingCount, error } = await supabase
        .from("message_templates")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "PENDING");
      if (cancelled || error) return;
      setCount(pendingCount ?? 0);
    })();

    const channel = supabase
      .channel("templates-pending-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_templates" },
        (payload) => {
          const newRow = payload.new as { user_id?: string; status?: string } | null;
          const oldRow = payload.old as { user_id?: string; status?: string } | null;
          if (newRow?.user_id !== user.id && oldRow?.user_id !== user.id) return;

          if (payload.eventType === "INSERT") {
            if (newRow?.status === "PENDING") setCount((n) => n + 1);
          } else if (payload.eventType === "UPDATE") {
            const wasPending = oldRow?.status === "PENDING";
            const isPending = newRow?.status === "PENDING";
            if (wasPending && !isPending) setCount((n) => Math.max(0, n - 1));
            else if (!wasPending && isPending) setCount((n) => n + 1);
          } else if (payload.eventType === "DELETE") {
            if (oldRow?.status === "PENDING") setCount((n) => Math.max(0, n - 1));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}
