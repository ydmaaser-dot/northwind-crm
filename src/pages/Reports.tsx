import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatTile } from "@/components/blocks";
import { errMsg, fmtDate, fmtMoney, stageColor, useContacts, useDeals, useProfiles } from "@/lib/crm";
import { download, toCsv } from "@/lib/csv";

const FUNNEL = ["Lead", "Qualified", "Proposal", "Won"] as const;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const Reports = () => {
  const { data: deals = [], isLoading, error } = useDeals();
  const { data: people = [] } = useProfiles();
  const { data: contacts = [] } = useContacts();

  const reached = FUNNEL.map((stage, i) => ({
    stage,
    count: deals.filter((d) => FUNNEL.indexOf(d.furthest_stage as (typeof FUNNEL)[number]) >= i).length,
  }));
  const total = deals.length;
  const won = deals.filter((d) => d.stage === "Won");
  const lost = deals.filter((d) => d.stage === "Lost");
  const closedCount = won.length + lost.length;
  const winRate = closedCount ? won.length / closedCount : null;
  const avgWon = won.length ? won.reduce((a, d) => a + Number(d.value), 0) / won.length : null;
  const avgAll = total ? deals.reduce((a, d) => a + Number(d.value), 0) / total : null;

  const exportCsv = () => {
    const name = (id: string | null) => people.find((p) => p.user_id === id)?.display_name ?? "";
    const contact = (id: string | null) => contacts.find((c) => c.id === id);
    const rows = [
      ["title", "value", "stage", "furthest stage", "owner", "contact", "company", "created", "won on", "reason"],
      ...deals.map((d) => [
        d.title, d.value, d.stage, d.furthest_stage, name(d.owner_id),
        contact(d.contact_id)?.name, contact(d.contact_id)?.company,
        d.created_at.slice(0, 10), d.closed_at?.slice(0, 10), d.close_reason,
      ]),
    ];
    download(`northwind-deals-${new Date().toLocaleDateString("en-CA")}.csv`, toCsv(rows));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="How deals move through the pipeline, and how many you win."
        actions={<Button className="rounded-full" disabled={!total} onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export all deals (CSV)</Button>}
      />
      {error && <p className="text-sm text-destructive">Couldn't load deals: {errMsg(error)}</p>}
      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Win rate" value={winRate === null ? "—" : pct(winRate)} hint={`${won.length} won of ${closedCount} closed`} variant="filled" />
        <StatTile label="Average won deal" value={avgWon === null ? "—" : fmtMoney(avgWon)} hint={`${won.length} won deals`} variant="outlined" />
        <StatTile label="Average deal size" value={avgAll === null ? "—" : fmtMoney(avgAll)} hint={`All ${total} deals`} variant="outlined" />
        <StatTile label="Lost" value={lost.length} hint={fmtMoney(lost.reduce((a, d) => a + Number(d.value), 0))} variant="outlined" />
      </div>

      <section className="rounded-3xl border bg-card p-5 md:p-6">
        <h2 className="text-lg font-semibold">Conversion funnel</h2>
        <p className="mb-5 text-sm text-muted-foreground">How many deals reached each stage, including those later lost.</p>
        {total === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Add deals on the Deals page and the funnel fills in here.</p>
        ) : (
          <ol className="space-y-3">
            {reached.map((r, i) => {
              const share = r.count / total;
              const fromPrev = i > 0 && reached[i - 1].count ? r.count / reached[i - 1].count : null;
              return (
                <li key={r.stage} className="grid grid-cols-[6rem_1fr] items-center gap-3 sm:grid-cols-[7rem_1fr_9rem]">
                  <span className="text-sm font-medium">{r.stage}</span>
                  <div className="h-9 overflow-hidden rounded-full bg-muted">
                    <div
                      className="flex h-full items-center rounded-full px-3 text-sm font-semibold text-white transition-[width] duration-700"
                      style={{ width: `${Math.max(share * 100, r.count ? 12 : 0)}%`, background: stageColor[r.stage] }}
                    >
                      {r.count > 0 && r.count}
                    </div>
                  </div>
                  <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm">
                    {pct(share)} of all{fromPrev !== null ? ` · ${pct(fromPrev)} from ${reached[i - 1].stage}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {lost.some((d) => d.close_reason) || won.some((d) => d.close_reason) ? (
        <section className="rounded-3xl border bg-card p-5 md:p-6">
          <h2 className="mb-4 text-lg font-semibold">Why deals closed</h2>
          <ul className="divide-y">
            {[...won, ...lost].filter((d) => d.close_reason).slice(0, 12).map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <span><span className="font-medium">{d.title}</span> <span className="text-muted-foreground">({d.stage}{d.closed_at ? `, ${fmtDate(d.closed_at)}` : ""})</span></span>
                <span className="text-muted-foreground sm:text-right">“{d.close_reason}”</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export default Reports;
