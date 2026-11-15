import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatusBadge } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, useMe, useProfiles } from "@/lib/crm";
import { showError, showSuccess } from "@/utils/toast";

const Team = () => {
  const { isAdmin, profile, loading } = useMe();
  const { data: people = [], isLoading } = useProfiles();
  const qc = useQueryClient();

  if (!loading && !isAdmin) return <Navigate replace to="/" />;

  const setRole = async (userId: string, role: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_member_role", { target: userId, new_role: role });
    if (error) return showError(error.message);
    showSuccess("Role updated");
    qc.invalidateQueries({ queryKey: ["profiles"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  const pending = people.filter((p) => p.role === "pending");
  const rest = people.filter((p) => p.role !== "pending");

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Approve new sign-ups and choose who is an admin. Admins manage the team; members work with contacts, deals and tasks." />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Waiting for approval ({pending.length})</h2>
          <ul className="divide-y overflow-hidden rounded-3xl border border-accent bg-accent/10">
            {pending.map((p) => (
              <li key={p.user_id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{p.display_name}</p>
                  <p className="text-xs text-muted-foreground">Signed up {fmtDate(p.created_at)}</p>
                </div>
                <Button className="rounded-full" size="sm" onClick={() => setRole(p.user_id, "member")}>Approve as member</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Team members ({rest.length})</h2>
        <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
          {rest.map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{p.display_name}{p.user_id === profile?.user_id && <span className="text-muted-foreground"> (you)</span>}</p>
                <StatusBadge tone={p.role === "admin" ? "accent" : "neutral"} variant="dot" size="sm">{p.role === "admin" ? "Admin" : "Member"}</StatusBadge>
              </div>
              <Select value={p.role} onValueChange={(v) => setRole(p.user_id, v)} disabled={p.user_id === profile?.user_id}>
                <SelectTrigger className="w-36 rounded-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="pending">Remove access</SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default Team;
