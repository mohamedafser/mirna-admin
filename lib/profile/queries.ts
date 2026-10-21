import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in admin's own account: the profile row (RLS: own row) plus
 * sign-in details from Supabase Auth (getUser() verifies with the Auth
 * server, so last_sign_in_at is current).
 */
export interface MyProfile {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

export const getMyProfile = cache(async (userId: string): Promise<MyProfile | null> => {
  const supabase = await createClient();
  const [{ data: auth, error: authError }, { data: profile, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("full_name, phone, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (authError || error) {
    console.error("[profile] load failed", {
      auth: authError?.code ?? "-",
      code: error?.code ?? "-",
    });
    throw new Error("Unable to load profile");
  }
  if (!profile || auth.user.id !== userId) return null;
  return {
    fullName: profile.full_name,
    phone: profile.phone,
    email: auth.user.email ?? null,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    lastSignInAt: auth.user.last_sign_in_at ?? null,
  };
});
