import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, FilterChips, PageHeader } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import { errMsg, fmtDateTime } from "@/lib/crm";

const verbs: Record<string, string> = { created: "added", updated: "changed", deleted: "deleted" };

const ActivityLog = () => {
  const [entity, setEntity] = useState("all");
  const { data = [], isLoading, error } = useQuery({
    enabled: Boolean(supabase),
    queryKey: ["activity"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("activity_log").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const shown = data.filter((a) => entity === "all" || a.entity === entity);
  const n = (e: string) => data.filter((a) => a.entity === e).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Activity" description="Who changed what, newest first (last 200 changes)." />
      <FilterChips
        value={entity}
        onChange={setEntity}
        options={[
          { value: "all", label: "Everything", count: data.length },
          { value: "contact", label: "Contacts", count: n("contact") },
          { value: "deal", label: "Deals", count: n("deal") },
          { value: "task", label: "Tasks", count: n("task") },
        ]}
      />
      {error ? (
        <p className="text-sm text-destructive">Couldn't load activity: {errMsg(error)}</p>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState variant="dashed" title="No activity yet" description="Changes to contacts, deals and tasks will show up here." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
          {shown.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 p-4 text-sm">
              <p>
                <span className="font-semibold">{a.actor_name}</span> {verbs[a.action] ?? a.action} the {a.entity}{" "}
                <span className="font-medium">{a.entity_name}</span>
                {a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}
              </p>
              <time className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ActivityLog;
