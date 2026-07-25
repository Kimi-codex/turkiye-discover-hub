import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AccountExperienceState =
  | "admin"
  | "owner"
  | "manager"
  | "business_applicant"
  | "business_prospect"
  | "explorer";

export type QueryStatus = "idle" | "loading" | "success" | "error";

interface ProfileRow {
  registration_intent: string | null;
  full_name: string | null;
  phone: string | null;
  preferred_language: string | null;
}

interface OnboardingRow {
  id: string;
  submission_type: string;
  status: string;
  approved_business_id: string | null;
  updated_at: string;
  created_at: string;
  events?: Array<{
    id: string;
    event_type: string;
    message_key: string | null;
    message_params: unknown;
    created_at: string;
  }>;
}

interface MemberRow {
  role: string;
  status: string;
  businesses: { id: string; name: string; slug: string } | null;
}

interface NotificationRow {
  id: string;
  title_key: string;
  message_key: string;
  message_params: unknown;
  related_business_id: string | null;
  related_submission_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface FavoriteRow {
  business_id: string;
  created_at: string;
  businesses: {
    id: string;
    slug: string;
    name: string;
    formatted_address: string | null;
    rating: number | null;
    review_count: number;
    business_images: Array<{
      source_url: string | null;
      r2_url: string | null;
      is_cover: boolean;
      sort_order: number;
    }>;
  } | null;
}

export interface AccountState {
  state: AccountExperienceState;
  profile: ProfileRow | null;
  onboarding: OnboardingRow[];
  memberships: MemberRow[];
  notifications: { rows: NotificationRow[]; unread: number };
  favorites: FavoriteRow[];
  isAdmin: boolean;
  queries: {
    profile: QueryStatus;
    favorites: QueryStatus;
    notifications: QueryStatus;
    onboarding: QueryStatus;
    memberships: QueryStatus;
    admin: QueryStatus;
  };
}

function derive(
  profile: ProfileRow | null,
  onboarding: OnboardingRow[],
  memberships: MemberRow[],
  isAdmin: boolean,
): AccountExperienceState {
  if (isAdmin) return "admin";

  const hasOwner = memberships.some((m) => m.role === "owner");
  if (hasOwner) return "owner";

  const hasManager = memberships.some((m) => m.role === "manager");
  if (hasManager) return "manager";

  const hasActiveSubmission = onboarding.some((s) =>
    ["draft", "submitted", "under_review", "changes_requested", "additional_documents_required"].includes(s.status),
  );
  if (hasActiveSubmission) return "business_applicant";

  if (profile?.registration_intent === "business") return "business_prospect";

  return "explorer";
}

export function useAccountState(): AccountState {
  const { user } = useAuth();
  const uid = user?.id;
  const enabled = !!uid;

  const profileQ = useQuery({
    queryKey: ["account:profile", uid],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("registration_intent, full_name, phone, preferred_language")
        .eq("id", uid!)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
  });

  const favoritesQ = useQuery({
    queryKey: ["favorites", uid],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select(
          "business_id, created_at, businesses:business_id(id, slug, name, formatted_address, rating, review_count, business_images(source_url, r2_url, is_cover, sort_order))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FavoriteRow[];
    },
  });

  const notificationsQ = useQuery({
    queryKey: ["user:notifications:summary", uid],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_notifications")
        .select("id, title_key, message_key, message_params, related_business_id, related_submission_id, read_at, created_at")
        .eq("user_id", uid!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = (data ?? []) as NotificationRow[];
      return { rows, unread: rows.filter((r) => !r.read_at).length };
    },
  });

  const onboardingQ = useQuery({
    queryKey: ["user:onboarding:summary", uid],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("business_onboarding_submissions")
        .select("id, submission_type, status, approved_business_id, updated_at, created_at, events:business_onboarding_events(id, event_type, message_key, message_params, created_at)")
        .eq("applicant_id", uid!)
        .order("updated_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as OnboardingRow[];
    },
  });

  const membershipsQ = useQuery({
    queryKey: ["user:business-memberships", uid],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("business_members")
        .select("role, status, businesses:business_id(id, name, slug)")
        .eq("user_id", uid!)
        .eq("status", "active")
        .in("role", ["owner", "manager"]);
      if (error) return [];
      return (data ?? []) as MemberRow[];
    },
  });

  const adminQ = useQuery({
    queryKey: ["account:admin", uid],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid!)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const state = derive(
    profileQ.data ?? null,
    onboardingQ.data ?? [],
    membershipsQ.data ?? [],
    adminQ.data ?? false,
  );

  return {
    state,
    profile: profileQ.data ?? null,
    onboarding: onboardingQ.data ?? [],
    memberships: membershipsQ.data ?? [],
    notifications: notificationsQ.data ?? { rows: [], unread: 0 },
    favorites: favoritesQ.data ?? [],
    isAdmin: adminQ.data ?? false,
    queries: {
      profile: profileQ.isLoading ? "loading" : profileQ.isError ? "error" : profileQ.data ? "success" : "idle",
      favorites: favoritesQ.isLoading ? "loading" : favoritesQ.isError ? "error" : "success",
      notifications: notificationsQ.isLoading ? "loading" : notificationsQ.isError ? "error" : "success",
      onboarding: onboardingQ.isLoading ? "loading" : onboardingQ.isError ? "error" : "success",
      memberships: membershipsQ.isLoading ? "loading" : membershipsQ.isError ? "error" : "success",
      admin: adminQ.isLoading ? "loading" : adminQ.isError ? "error" : "success",
    },
  };
}
