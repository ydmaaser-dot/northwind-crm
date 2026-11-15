import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { STAGES, type Stage, errMsg, fmtMoney, stageColor, useContacts, useDeals, useMe, useProfiles } from "@/lib/crm";
import { showError, showSuccess } from "@/utils/toast";
import { cn } from "@/lib/utils";

type Deal = Tables<"deals">;
type Draft = { id?: string; title: string; value: string; stage: string; owner_id: string; contact_id: string };

const Deals = () => {
  const qc = useQueryClient();
  const { data: deals = [], isLoading, error } = useDeals();
  const { data: people = [] } = useProfiles();
  const { data: contacts = [] } = useContacts();
  const { profile } = useMe();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const team = people.filter((p) => p.role !== "pending");
  const ownerName = (id: string | null) => people.find((p) => p.user_id === id)?.display_name ?? "Unassigned";
  const contactName = (id: string | null) => contacts.find((c) => c.id === id)?.name;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const move = async (id: string, stage: Stage) => {
    const deal = deals.find((d) => d.id === id);
    if (!supabase || !deal || deal.stage === stage) return;
    qc.setQueryData<Deal[]>(["deals"], (old) => old?.map((d) => (d.id === id ? { ...d, stage } : d)));
    const { error } = await supabase.from("deals").update({ stage }).eq("id", id);
    if (error) showError(`Couldn't move the deal: ${error.message}`);
    refresh();
  };

  const newDraft = (stage: string = "Lead"): Draft => ({ title: "", value: "", stage, owner_id: profile?.user_id ?? "", contact_id: "none" });

  const save = async () => {
    if (!supabase || !draft) return;
    if (!draft.title.trim()) return showError("Please give the deal a title.");
    const value = Number(draft.value || 0);
    if (!Number.isFinite(value) || value < 0) return showError("The value must be a positive number.");
    setSaving(true);
    const payload = { title: draft.title.trim(), value, stage: draft.stage, owner_id: draft.owner_id || null, contact_id: draft.contact_id === "none" ? null : draft.contact_id };
    const { error } = draft.id ? await supabase.from("deals").update(payload).eq("id", draft.id) : await supabase.from("deals").insert(payload);
    setSaving(false);
    if (error) return showError(error.message);
    showSuccess(draft.id ? "Deal updated" : "Deal added");
    setDraft(null);
    refresh();
  };

  const remove = async () => {
    if (!supabase || !draft?.id) return;
    const { error } = await supabase.from("deals").delete().eq("id", draft.id);
    setConfirmDelete(false);
    if (error) return showError(error.message);
    showSuccess("Deal deleted");
    setDraft(null);
    refresh();
  };

  const open = (d: Deal): Draft => ({ id: d.id, title: d.title, value: String(d.value), stage: d.stage, owner_id: d.owner_id ?? "", contact_id: d.contact_id ?? "none" });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deals"
        description="Drag a deal to another stage, or open it to edit."
        actions={<Button className="rounded-full" onClick={() => setDraft(newDraft())}><Plus className="mr-1 h-4 w-4" />Add deal</Button>}
      />
      {error && <p className="text-sm text-destructive">Couldn't load deals: {errMsg(error)}</p>}
      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {STAGES.map((stage) => {
          const list = deals.filter((d) => d.stage === stage);
          const total = list.reduce((a, d) => a + Number(d.value), 0);
          return (
            <section
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) move(id, stage);
                setDragId(null);
              }}
              className={cn("flex min-h-[22rem] w-72 shrink-0 snap-start flex-col rounded-3xl border bg-muted/60 p-3 transition-colors md:w-0 md:min-w-[12rem] md:flex-1", overStage === stage && "border-accent bg-accent/15")}
            >
              <header className="mb-3 px-1">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor[stage] }} />{stage}
                  </h2>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium">{list.length}</span>
                </div>
                <p className="text-sm text-muted-foreground">{fmtMoney(total)}</p>
              </header>
              <div className="flex-1 space-y-2">
                {list.map((d) => (
                  <article
                    key={d.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; setDragId(d.id); }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => setDraft(open(d))}
                    className={cn("cursor-grab rounded-2xl border border-l-4 bg-card p-3 shadow-sm active:cursor-grabbing", dragId === d.id && "opacity-40")}
                    style={{ borderLeftColor: stageColor[stage] }}
                  >
                    <p className="font-medium leading-snug">{d.title}</p>
                    <p className="mt-1 font-display text-lg font-semibold">{fmtMoney(d.value)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ownerName(d.owner_id)}{contactName(d.contact_id) ? ` · ${contactName(d.contact_id)}` : ""}</p>
                  </article>
                ))}
                {list.length === 0 && <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">Drop a deal here</p>}
              </div>
              <Button variant="ghost" size="sm" className="mt-2 justify-start rounded-full text-muted-foreground" onClick={() => setDraft(newDraft(stage))}>
                <Plus className="mr-1 h-4 w-4" />Add
              </Button>
            </section>
          );
        })}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit deal" : "Add deal"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="rounded-xl" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Value (USD)</Label><Input type="number" min={0} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="rounded-xl" /></div>
                <div>
                  <Label>Stage</Label>
                  <Select value={draft.stage} onValueChange={(v) => setDraft({ ...draft, stage: v })}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Owner</Label>
                  <Select value={draft.owner_id} onValueChange={(v) => setDraft({ ...draft, owner_id: v })}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose owner" /></SelectTrigger>
                    <SelectContent>{team.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Contact</Label>
                  <Select value={draft.contact_id} onValueChange={(v) => setDraft({ ...draft, contact_id: v })}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No contact</SelectItem>
                      {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {draft?.id ? (
              <Button variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setDraft(null)}>Cancel</Button>
              <Button className="rounded-full" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>It disappears for the whole team. Tasks linked to it stay, but lose the link.</AlertDialogDescription>
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

export default Deals;
