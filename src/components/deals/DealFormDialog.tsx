import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { STAGES, useContacts, useProfiles } from "@/lib/crm";
import { showError, showSuccess } from "@/utils/toast";

export type DealDraft = { id?: string; title: string; value: string; stage: string; owner_id: string; contact_id: string; close_reason: string };

export const isClosed = (stage: string) => stage === "Won" || stage === "Lost";

export const draftFromDeal = (d: Tables<"deals">): DealDraft => ({
  id: d.id,
  title: d.title,
  value: String(d.value),
  stage: d.stage,
  owner_id: d.owner_id ?? "",
  contact_id: d.contact_id ?? "none",
  close_reason: d.close_reason ?? "",
});

type Props = {
  draft: DealDraft | null;
  setDraft: (d: DealDraft | null) => void;
  onSaved: (id?: string) => void;
  onDelete?: () => void;
};

export default function DealFormDialog({ draft, setDraft, onSaved, onDelete }: Props) {
  const { data: people = [] } = useProfiles();
  const { data: contacts = [] } = useContacts();
  const [saving, setSaving] = useState(false);
  const team = people.filter((p) => p.role !== "pending");

  const save = async () => {
    if (!supabase || !draft) return;
    if (!draft.title.trim()) return showError("Please give the deal a title.");
    const value = Number(draft.value || 0);
    if (!Number.isFinite(value) || value < 0) return showError("The value must be a positive number.");
    if (isClosed(draft.stage) && !draft.close_reason.trim()) return showError(`Please say why the deal was ${draft.stage.toLowerCase()}.`);
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      value,
      stage: draft.stage,
      owner_id: draft.owner_id || null,
      contact_id: draft.contact_id === "none" ? null : draft.contact_id,
      close_reason: isClosed(draft.stage) ? draft.close_reason.trim() : null,
    };
    const res = draft.id
      ? await supabase.from("deals").update(payload).eq("id", draft.id).select("id").single()
      : await supabase.from("deals").insert(payload).select("id").single();
    setSaving(false);
    if (res.error) return showError(res.error.message);
    showSuccess(draft.id ? "Deal updated" : "Deal added");
    setDraft(null);
    onSaved(res.data.id);
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>{draft?.id ? "Edit deal" : "Add deal"}</DialogTitle></DialogHeader>
        {draft && (
          <div className="grid gap-3">
            <div><Label htmlFor="deal-title">Title</Label><Input id="deal-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="rounded-xl" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="deal-value">Value (USD)</Label><Input id="deal-value" type="number" min={0} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="rounded-xl" /></div>
              <div>
                <Label htmlFor="deal-stage">Stage</Label>
                <Select value={draft.stage} onValueChange={(v) => setDraft({ ...draft, stage: v })}>
                  <SelectTrigger id="deal-stage" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {isClosed(draft.stage) && (
              <div>
                <Label htmlFor="deal-reason">Why was it {draft.stage.toLowerCase()}?</Label>
                <Textarea id="deal-reason" rows={2} value={draft.close_reason} onChange={(e) => setDraft({ ...draft, close_reason: e.target.value })} className="rounded-xl" placeholder={draft.stage === "Won" ? "Best price and fast delivery" : "Went with a cheaper supplier"} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="deal-owner">Owner</Label>
                <Select value={draft.owner_id} onValueChange={(v) => setDraft({ ...draft, owner_id: v })}>
                  <SelectTrigger id="deal-owner" className="rounded-xl"><SelectValue placeholder="Choose owner" /></SelectTrigger>
                  <SelectContent>{team.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="deal-contact">Contact</Label>
                <Select value={draft.contact_id} onValueChange={(v) => setDraft({ ...draft, contact_id: v })}>
                  <SelectTrigger id="deal-contact" className="rounded-xl"><SelectValue /></SelectTrigger>
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
          {draft?.id && onDelete ? (
            <Button variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="rounded-full" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
