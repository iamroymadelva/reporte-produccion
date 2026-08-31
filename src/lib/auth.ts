import type { AstroCookies } from "astro";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase/server";
import type { AppRole, Profile } from "./types";

export interface AuthContext {
  user: User;
  profile: Profile;
}

export async function getAuthContext(request: Request, cookies: AstroCookies): Promise<AuthContext | null> {
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, job_title, active")
    .eq("id", data.user.id)
    .single();

  if (!profile?.active) return null;

  return { user: data.user, profile: profile as Profile };
}

export function hasRole(auth: AuthContext | null, ...roles: AppRole[]) {
  return Boolean(auth && roles.includes(auth.profile.role));
}
