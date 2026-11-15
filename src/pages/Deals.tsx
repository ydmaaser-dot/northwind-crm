import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/blocks";
import DealFormDialog, { type DealDraft, isClosed } from "@/components/deals/DealFormDialog";
import CloseReasonDialog from "@/components/deals/CloseReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { STAGES, type Stage, errMsg, fmtMoney, stageColor, useContacts, useDeals, useMe, useProfiles } from "@/lib/crm";
import { showError } from "@/utils/toast";
import { cn } from "@/lib/utils";

type Deal = Tables<"deals">;

const Deals = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: deals = [], isLoading, error } = useDeals();
  const { data: people = [] } = useProfiles();
  const { data: contacts = [] } = useContacts();
  const { profile } = useMe();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [draft, setDraft] = useState<DealDraft | null>(null);
  const [closing, setClosing] = useState<{ id: string; stage: "Won" | "Lost" } | null>(null);

  const ownerName = (id: string | null) => people.find((p) => p.user_id === id)?.display_name ?? "Unassigned";
  const contactName = (id: string | null) => contacts.find((c) => c.id === id)?.name;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const move = async (id: string, stage: Stage, close_reason: string | null = null) => {
    const deal = deals.find((d) => d.id === id);
    if (!supabase || !deal || deal.stage === stage) return;
    qc.setQueryData<Deal[]>(["deals"], (old) => old?.map((d) => (d.id === id ? { ...d, stage, close_reason } : d)));
    const { error } = await supabase.from("deals").update({ stage, close_reason }).eq("id", id);
    if (error) showError(`Couldn't move the deal: ${error.message}`);
    refresh();
  };

  const drop = (id: string, stage: Stage) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    if (isClosed(stage)) setClosing({ id, stage: stage as "Won" | "Lost" });
    else move(id, stage);
  };

  const newDraft = (stage: string = "Lead"): DealDraft => ({ title: "", value: "", stage, owner_id: profile?.user_id ?? "", contact_id: "none", close_reason: "" });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deals"
        description="Drag a deal to another stage, or open it for its notes and details."
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
                if (id) drop(id, stage);
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
                    role="link"
                    tabIndex={0}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; setDragId(d.id); }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => navigate(`/deals/${d.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/deals/${d.id}`)}
                    className={cn("cursor-grab rounded-2xl border border-l-4 bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing", dragId === d.id && "opacity-40")}
                    style={{ borderLeftColor: stageColor[stage] }}
                  >
                    <p className="font-medium leading-snug">{d.title}</p>
                    <p className="mt-1 font-display text-lg font-semibold">{fmtMoney(d.value)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ownerName(d.owner_id)}{contactName(d.contact_id) ? ` · ${contactName(d.contact_id)}` : ""}</p>
                    {d.close_reason && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">“{d.close_reason}”</p>}
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

      <DealFormDialog draft={draft} setDraft={setDraft} onSaved={refresh} />

      <CloseReasonDialog
        stage={closing?.stage ?? null}
        dealTitle={deals.find((d) => d.id === closing?.id)?.title}
        onCancel={() => setClosing(null)}
        onConfirm={async (reason) => {
          if (closing) await move(closing.id, closing.stage, reason);
          setClosing(null);
        }}
      />
    </div>
  );
};

export default Deals;
