import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState, StatusBadge } from "@/components/blocks";
import DealFormDialog, { type DealDraft, draftFromDeal, isClosed } from "@/components/deals/DealFormDialog";
import CloseReasonDialog from "@/components/deals/CloseReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, type Stage, errMsg, fmtDate, fmtDateTime, fmtMoney, stageColor, stageTone, useContacts, useDeals, useMe, useProfiles } from "@/lib/crm";
import { showError, showSuccess } from "@/utils/toast";
import { cn } from "@/lib/utils";

const DealDetail = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: deals = [], isLoading, error } = useDeals();
  const { data: people = [] } = useProfiles();
  const { data: contacts = [] } = useContacts();
  const { profile } = useMe();
  const [draft, setDraft] = useState<DealDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [closing, setClosing] = useState<"Won" | "Lost" | null>(null);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);

  const notes = useQuery({
    enabled: Boolean(supabase && id),
    queryKey: ["deal_notes", id],
    queryFn: async () => {
      const { data, error } = await supabase!.from("deal_notes").select("*").eq("deal_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const index = deals.findIndex((d) => d.id === id);
  const deal = deals[index];
  const prev = index > 0 ? deals[index - 1] : null;
  const next = index >= 0 && index < deals.length - 1 ? deals[index + 1] : null;
  const nameOf = (uid: string | null) => people.find((p) => p.user_id === uid)?.display_name ?? "Former member";
  const contact = contacts.find((c) => c.id === deal?.contact_id);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const setStage = async (stage: Stage, close_reason: string | null = null) => {
    if (!supabase || !deal) return;
    const { error } = await supabase.from("deals").update({ stage, close_reason }).eq("id", deal.id);
    if (error) return showError(`Couldn't move the deal: ${error.message}`);
    showSuccess(`Moved to ${stage}`);
    refresh();
  };

  const pickStage = (stage: Stage) => {
    if (!deal || deal.stage === stage) return;
    if (isClosed(stage)) setClosing(stage as "Won" | "Lost");
    else setStage(stage);
  };

  const addNote = async () => {
    if (!supabase || !deal || !note.trim() || !profile) return;
    setPosting(true);
    const { error } = await supabase.from("deal_notes").insert({ deal_id: deal.id, body: note.trim(), author_id: profile.user_id });
    setPosting(false);
    if (error) return showError(`Couldn't add the note: ${error.message}`);
    setNote("");
    qc.invalidateQueries({ queryKey: ["deal_notes", id] });
  };

  const deleteNote = async (noteId: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("deal_notes").delete().eq("id", noteId);
    if (error) return showError(`Couldn't delete the note: ${error.message}`);
    qc.invalidateQueries({ queryKey: ["deal_notes", id] });
  };

  const remove = async () => {
    if (!supabase || !deal) return;
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setConfirmDelete(false);
    if (error) return showError(error.message);
    showSuccess("Deal deleted");
    setDraft(null);
    refresh();
    navigate("/deals");
  };

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Couldn't load the deal: {errMsg(error)}</p>;
  if (!deal) {
    return (
      <EmptyState
        variant="dashed"
        title="This deal isn't here"
        description="It may have been deleted by someone on the team."
        action={<Button asChild className="rounded-full"><Link to="/deals">Back to deals</Link></Button>}
      />
    );
  }

  const stage = deal.stage as Stage;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="rounded-full"><Link to="/deals"><ArrowLeft className="mr-1 h-4 w-4" />All deals</Link></Button>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="rounded-full" disabled={!prev} onClick={() => prev && navigate(`/deals/${prev.id}`)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
          <Button variant="outline" size="sm" className="rounded-full" disabled={!next} onClick={() => next && navigate(`/deals/${next.id}`)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </div>

      <section className="rounded-3xl border border-l-8 bg-card p-5 md:p-6" style={{ borderLeftColor: stageColor[stage] }}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <StatusBadge tone={stageTone[stage]} variant="soft" size="sm">{stage}</StatusBadge>
            <h1 className="font-display text-2xl font-semibold md:text-3xl">{deal.title}</h1>
            <p className="font-display text-3xl font-semibold">{fmtMoney(deal.value)}</p>
            <p className="text-sm text-muted-foreground">
              Owner: {deal.owner_id ? nameOf(deal.owner_id) : "Unassigned"}
              {contact ? ` · Contact: ${contact.name}${contact.company ? ` (${contact.company})` : ""}` : ""}
              {` · Added ${fmtDate(deal.created_at)}`}
              {deal.closed_at ? ` · Won ${fmtDate(deal.closed_at)}` : ""}
            </p>
            {deal.close_reason && (
              <p className="rounded-2xl bg-muted px-4 py-2 text-sm"><span className="font-medium">Why {stage.toLowerCase()}:</span> {deal.close_reason}</p>
            )}
          </div>
          <Button variant="outline" className="shrink-0 rounded-full" onClick={() => setDraft(draftFromDeal(deal))}><Pencil className="mr-2 h-4 w-4" />Edit deal</Button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Stage</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => pickStage(s)}
                aria-pressed={s === stage}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  s === stage ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: stageColor[s] }} />{s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border bg-card p-5 md:p-6">
        <h2 className="mb-4 text-lg font-semibold">Notes</h2>
        <div className="mb-6 space-y-2">
          <Label htmlFor="deal-note">Add a note</Label>
          <Textarea id="deal-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} className="rounded-xl" placeholder="Called the buyer, they want a revised quote by Friday." />
          <div className="flex justify-end">
            <Button className="rounded-full" disabled={posting || !note.trim()} onClick={addNote}>{posting ? "Adding…" : "Add note"}</Button>
          </div>
        </div>

        {notes.error ? (
          <p className="text-sm text-destructive">Couldn't load notes: {errMsg(notes.error)}</p>
        ) : notes.isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !notes.data?.length ? (
          <EmptyState variant="plain" size="compact" title="No notes yet" description="Write what happened on the last call or meeting, and the team will see it here." />
        ) : (
          <ol className="relative space-y-5 border-l-2 border-border pl-6">
            {notes.data.map((n) => (
              <li key={n.id} className="relative">
                <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{nameOf(n.author_id)}</span>
                    <span className="text-muted-foreground"> · {fmtDateTime(n.created_at)}</span>
                  </p>
                  {n.author_id === profile?.user_id && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete note" onClick={() => deleteNote(n.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <DealFormDialog draft={draft} setDraft={setDraft} onSaved={refresh} onDelete={() => setConfirmDelete(true)} />

      <CloseReasonDialog
        stage={closing}
        dealTitle={deal.title}
        onCancel={() => setClosing(null)}
        onConfirm={async (reason) => {
          if (closing) await setStage(closing, reason);
          setClosing(null);
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>It disappears for the whole team, with its notes. Tasks linked to it stay, but lose the link.</AlertDialogDescription>
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

export default DealDetail;
