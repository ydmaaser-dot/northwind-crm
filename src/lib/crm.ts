import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export const STAGES = ["Lead", "Qualified", "Proposal", "Won", "Lost"] as const;
export type Stage = (typeof STAGES)[number];
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const stageTone: Record<Stage, Tone> = {
  Lead: "neutral",
  Qualified: "info",
  Proposal: "warning",
  Won: "success",
  Lost: "danger",
};
export const stageColor: Record<Stage, string> = {
  Lead: "hsl(var(--muted-foreground))",
  Qualified: "hsl(var(--info))",
  Proposal: "hsl(var(--warning))",
  Won: "hsl(var(--success))",
  Lost: "hsl(var(--danger))",
};
export const CONTACT_STATUSES = ["Lead", "Customer", "Partner", "Other"] as const;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtMoney = (n: number | null | undefined) => money.format(Number(n ?? 0));
export const todayStr = () => new Date().toLocaleDateString("en-CA");
export const fmtDate = (s: string) =>
  new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function useMe() {
  const { user, loading } = useAuth();
  const q = useQuery({
    enabled: Boolean(supabase && user),
    queryKey: ["me", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase!.from("profiles").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  return {
    profile: q.data ?? null,
    loading: loading || (Boolean(user) && q.isLoading),
    isAdmin: q.data?.role === "admin",
    isPending: q.data?.role === "pending",
  };
}

export function useProfiles() {
  return useQuery({
    enabled: Boolean(supabase),
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("profiles").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useContacts() {
  return useQuery({
    enabled: Boolean(supabase),
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("contacts").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useDeals() {
  return useQuery({
    enabled: Boolean(supabase),
    queryKey: ["deals"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("deals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useTasks() {
  return useQuery({
    enabled: Boolean(supabase),
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("tasks").select("*").order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Something went wrong");
