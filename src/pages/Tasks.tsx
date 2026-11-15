import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, FilterChips, PageHeader, StatusBadge } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { errMsg, fmtDate, todayStr, useContacts, useDeals, useMe, useProfiles, useTasks } from "@/lib/crm";
import { showError, showSuccess } from "@/utils/toast";

type Task = Tables<"tasks">;
type Draft = { id?: string; title: string; due_date: string; link: string; assigned_to: string };

const Tasks = () => {
  const qc = useQueryClient();
  const { data: tasks = [], isLoading, error } = useTasks();
  const { data: contacts = [] } = useContacts();
  const { data: deals = [] } = useDeals();
  const { data: people = [] } = useProfiles();
  const { profile } = useMe();
  const [view, setView] = useState("open");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Task | null>(null);
  const today = todayStr();

  const isOverdue = (t: Task) => !t.done && !!t.due_date && t.due_date < today;
  const counts = { open: tasks.filter((t) => !t.done).length, overdue: tasks.filter(isOverdue).length, done: tasks.filter((t) => t.done).length, all: tasks.length };
  const shown = tasks.filter((t) => view === "all" || (view === "open" && !t.done) || (view === "overdue" && isOverdue(t)) || (view === "done" && t.done));
  const team = people.filter((p) => p.role !== "pending");
  const nameOf = (id: string | null) => people.find((p) => p.user_id === id)?.display_name;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const toggle = async (t: Task) => {
    if (!supabase) return;
    qc.setQueryData<Task[]>(["tasks"], (old) => old?.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    const { error } = await supabase.from("tasks").update({ done: !t.done }).eq("id", t.id);
    if (error) showError(error.message);
    refresh();
  };

  const save = async () => {
    if (!supabase || !draft) return;
    if (!draft.title.trim()) return showError("Please describe the task.");
    setSaving(true);
    const [kind, id] = draft.link.split(":");
    const payload = {
      title: draft.title.trim(),
      due_date: draft.due_date || null,
      contact_id: kind === "contact" ? id : null,
      deal_id: kind === "deal" ? id : null,
      assigned_to: draft.assigned_to || null,
    };
    const { error } = draft.id ? await supabase.from("tasks").update(payload).eq("id", draft.id) : await supabase.from("tasks").insert(payload);
    setSaving(false);
    if (error) return showError(error.message);
    showSuccess(draft.id ? "Task updated" : "Task added");
    setDraft(null);
    refresh();
  };

  const remove = async () => {
    if (!supabase || !toDelete) return;
    const { error } = await supabase.from("tasks").delete().eq("id", toDelete.id);
    setToDelete(null);
    if (error) return showError(error.message);
    showSuccess("Task deleted");
    refresh();
  };

  const linkLabel = (t: Task) => {
    if (t.contact_id) return `Contact: ${contacts.find((c) => c.id === t.contact_id)?.name ?? "removed"}`;
    if (t.deal_id) return `Deal: ${deals.find((d) => d.id === t.deal_id)?.title ?? "removed"}`;
    return null;
  };

  const blank: Draft = { title: "", due_date: today, link: "none", assigned_to: profile?.user_id ?? "" };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description={`${counts.open} open, ${counts.overdue} overdue.`}
        actions={<Button className="rounded-full" onClick={() => setDraft(blank)}><Plus className="mr-1 h-4 w-4" />Add task</Button>}
      />
      <FilterChips
        value={view}
        onChange={setView}
        options={[
          { value: "open", label: "Open", count: counts.open },
          { value: "overdue", label: "Overdue", count: counts.overdue, tone: "warning" },
          { value: "done", label: "Done", count: counts.done, tone: "success" },
          { value: "all", label: "All", count: counts.all },
        ]}
      />

      {error ? (
        <p className="text-sm text-destructive">Couldn't load tasks: {errMsg(error)}</p>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState variant="dashed" title="No tasks here" description="Add a follow-up and link it to a contact or a deal." action={<Button className="rounded-full" onClick={() => setDraft(blank)}>Add task</Button>} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
          {shown.map((t) => (
            <li key={t.id} className="flex items-start gap-3 p-4">
              <Checkbox checked={t.done} onCheckedChange={() => toggle(t)} className="mt-1" aria-label={`Mark ${t.title} done`} />
              <div className="min-w-0 flex-1">
                <p className={t.done ? "text-muted-foreground line-through" : "font-medium"}>{t.title}</p>
                <p className="text-sm text-muted-foreground">{[linkLabel(t), nameOf(t.assigned_to) && `For ${nameOf(t.assigned_to)}`].filter(Boolean).join(" · ")}</p>
              </div>
              {t.done ? <StatusBadge tone="success" variant="dot" size="sm">Done</StatusBadge> : isOverdue(t) ? <StatusBadge tone="warning" variant="dot" size="sm">Overdue {fmtDate(t.due_date!)}</StatusBadge> : t.due_date ? <StatusBadge tone="neutral" variant="dot" size="sm">Due {fmtDate(t.due_date)}</StatusBadge> : null}
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label="Edit task" onClick={() => setDraft({ id: t.id, title: t.title, due_date: t.due_date ?? "", link: t.contact_id ? `contact:${t.contact_id}` : t.deal_id ? `deal:${t.deal_id}` : "none", assigned_to: t.assigned_to ?? "" })}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Delete task" onClick={() => setToDelete(t)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit task" : "Add task"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div><Label>Task</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="rounded-xl" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Due date</Label><Input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} className="rounded-xl" /></div>
                <div>
                  <Label>Assigned to</Label>
                  <Select value={draft.assigned_to} onValueChange={(v) => setDraft({ ...draft, assigned_to: v })}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{team.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Linked to</Label>
                <Select value={draft.link} onValueChange={(v) => setDraft({ ...draft, link: v })}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nothing</SelectItem>
                    {contacts.map((c) => <SelectItem key={c.id} value={`contact:${c.id}`}>Contact: {c.name}</SelectItem>)}
                    {deals.map((d) => <SelectItem key={d.id} value={`deal:${d.id}`}>Deal: {d.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="rounded-full" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>“{toDelete?.title}” will be removed for the whole team.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Tasks;
