import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, FilterChips, PageHeader, SearchInput, StatusBadge } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { CONTACT_STATUSES, errMsg, useContacts } from "@/lib/crm";
import { download, parseCsv, toCsv } from "@/lib/csv";
import { showError, showSuccess } from "@/utils/toast";

type Contact = Tables<"contacts">;
type Draft = { id?: string; name: string; company: string; email: string; phone: string; notes: string; status: string };
const blank: Draft = { name: "", company: "", email: "", phone: "", notes: "", status: "Lead" };
const statusTone = { Lead: "info", Customer: "success", Partner: "accent", Other: "neutral" } as const;

const Contacts = () => {
  const qc = useQueryClient();
  const { data: contacts = [], isLoading, error } = useContacts();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [company, setCompany] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Contact | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const companies = useMemo(() => [...new Set(contacts.map((c) => c.company).filter(Boolean))].sort(), [contacts]);
  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    return (
      (status === "all" || c.status === status) &&
      (company === "all" || c.company === company) &&
      (!q || [c.name, c.company, c.email, c.phone, c.notes].some((f) => f?.toLowerCase().includes(q)))
    );
  });
  const counts = (s: string) => (s === "all" ? contacts.length : contacts.filter((c) => c.status === s).length);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const save = async () => {
    if (!supabase || !draft) return;
    if (!draft.name.trim()) return showError("Please enter a name.");
    setSaving(true);
    const { id, ...fields } = draft;
    const payload = { ...fields, name: fields.name.trim() };
    const { error } = id ? await supabase.from("contacts").update(payload).eq("id", id) : await supabase.from("contacts").insert(payload);
    setSaving(false);
    if (error) return showError(error.message);
    showSuccess(id ? "Contact updated" : "Contact added");
    setDraft(null);
    refresh();
  };

  const remove = async () => {
    if (!supabase || !toDelete) return;
    const { error } = await supabase.from("contacts").delete().eq("id", toDelete.id);
    setToDelete(null);
    if (error) return showError(error.message);
    showSuccess("Contact deleted");
    refresh();
  };

  const exportCsv = () => {
    const rows = [["name", "company", "email", "phone", "status", "notes"], ...filtered.map((c) => [c.name, c.company, c.email, c.phone, c.status, c.notes])];
    download("northwind-contacts.csv", toCsv(rows));
  };

  const importCsv = async (file: File) => {
    if (!supabase) return;
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("The file needs a header row and at least one contact.");
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (...names: string[]) => head.findIndex((h) => names.includes(h));
      const ix = { name: idx("name", "full name", "contact"), company: idx("company", "organization", "organisation"), email: idx("email", "e-mail"), phone: idx("phone", "telephone", "mobile"), notes: idx("notes", "note"), status: idx("status") };
      if (ix.name < 0) throw new Error('No "name" column found. The first row must name the columns: name, company, email, phone, notes.');
      const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
      const records = rows.slice(1).map((r) => {
        const s = get(r, ix.status);
        const match = CONTACT_STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
        return { name: get(r, ix.name), company: get(r, ix.company), email: get(r, ix.email), phone: get(r, ix.phone), notes: get(r, ix.notes), status: match ?? "Lead" };
      }).filter((r) => r.name);
      if (!records.length) throw new Error("No contacts with a name were found in the file.");
      for (let i = 0; i < records.length; i += 200) {
        const { error } = await supabase.from("contacts").insert(records.slice(i, i + 200));
        if (error) throw error;
      }
      showSuccess(`Imported ${records.length} contacts`);
      refresh();
    } catch (e) {
      showError(errMsg(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => d && { ...d, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contacts"
        description={`${contacts.length} people and companies your team talks to.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            <Button variant="outline" className="rounded-full" disabled={importing} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />{importing ? "Importing…" : "Import CSV"}
            </Button>
            <Button variant="outline" className="rounded-full" disabled={!filtered.length} onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />Export CSV
            </Button>
            <Button className="rounded-full" onClick={() => setDraft(blank)}><Plus className="mr-1 h-4 w-4" />Add contact</Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder="Search name, company, email, phone, notes…" /></div>
        <Select value={company} onValueChange={setCompany}>
          <SelectTrigger className="w-full rounded-full md:w-56"><SelectValue placeholder="Company" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <FilterChips
        value={status}
        onChange={setStatus}
        options={[{ value: "all", label: "All", count: counts("all") }, ...CONTACT_STATUSES.map((s) => ({ value: s, label: s, count: counts(s) }))]}
      />

      {error ? (
        <p className="text-sm text-destructive">Couldn't load contacts: {errMsg(error)}</p>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="dashed"
          title={contacts.length ? "No contacts match" : "No contacts yet"}
          description={contacts.length ? "Try a different search or filter." : "Add your first contact, or import a CSV with the columns name, company, email, phone, notes."}
          action={<Button className="rounded-full" onClick={() => setDraft(blank)}>Add contact</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-3xl border bg-card">
          <ul className="divide-y">
            {filtered.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <StatusBadge tone={statusTone[c.status as keyof typeof statusTone] ?? "neutral"} variant="dot" size="sm">{c.status}</StatusBadge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No details yet"}</p>
                  {c.notes && <p className="mt-1 line-clamp-2 text-sm">{c.notes}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setDraft({ id: c.id, name: c.name, company: c.company ?? "", email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "", status: c.status })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} onClick={() => setToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit contact" : "Add contact"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div><Label>Name</Label><Input value={draft.name} onChange={set("name")} className="rounded-xl" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Company</Label><Input value={draft.company} onChange={set("company")} className="rounded-xl" /></div>
                <div>
                  <Label>Status</Label>
                  <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTACT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Email</Label><Input type="email" value={draft.email} onChange={set("email")} className="rounded-xl" /></div>
                <div><Label>Phone</Label><Input value={draft.phone} onChange={set("phone")} className="rounded-xl" /></div>
              </div>
              <div><Label>Notes</Label><Textarea rows={4} value={draft.notes} onChange={set("notes")} className="rounded-xl" /></div>
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
            <AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the contact for the whole team. Deals and tasks linked to them stay, but lose the link.</AlertDialogDescription>
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

export default Contacts;
