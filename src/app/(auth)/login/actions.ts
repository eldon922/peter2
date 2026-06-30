"use server";

import { createClient } from "@/lib/supabase/server";

export async function loginWithUsername(username: string, password: string) {
  const supabase = await createClient();
  const domain = process.env.USERNAME_EMAIL_DOMAIN || "";
  const email = username.trim().toLowerCase() + domain;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
