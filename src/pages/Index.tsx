import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatTile } from "@/components/blocks";
import { STAGES, fmtDate, fmtMoney, stageColor, todayStr, useDeals, useMe, useTasks } from "@/lib/crm";

const compact = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);

const Index = () => {
  const deals = useDeals().data ?? [];
  const tasks = useTasks().data ?? [];
  const { profile } = useMe();
  const today = todayStr();

  const byStage = STAGES.map((s) => ({
    stage: s,
    value: deals.filter((d) => d.stage === s).reduce((a, d) => a + Number(d.value), 0),
  }));
  const openValue = byStage.slice(0, 3).reduce((a, s) => a + s.value, 0);
  const openCount = deals.filter((d) => ["Lead", "Qualified", "Proposal"].includes(d.stage)).length;

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString(undefined, { month: "short" }), won: 0, value: 0 };
  });
  deals.forEach((d) => {
    if (d.stage !== "Won" || !d.closed_at) return;
    const dt = new Date(d.closed_at);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const m = months.find((x) => x.key === key);
    if (m) {
      m.won += 1;
      m.value += Number(d.value);
    }
  });
  const wonThisMonth = months[5];

  const overdue = tasks.filter((t) => !t.done && t.due_date && t.due_date < today);
  const openTasks = tasks.filter((t) => !t.done).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello${profile ? `, ${profile.display_name}` : ""}`}
        description="Where the pipeline and your team's follow-ups stand today."
        actions={
          <div className="flex gap-2">
            <Button asChild className="rounded-full"><Link to="/deals"><Plus className="mr-1 h-4 w-4" />Add a deal</Link></Button>
            <Button asChild variant="outline" className="rounded-full"><Link to="/tasks">Add a task</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open pipeline" value={fmtMoney(openValue)} hint={`${openCount} open deals`} variant="filled" />
        <StatTile label="Won this month" value={fmtMoney(wonThisMonth.value)} hint={`${wonThisMonth.won} deals`} variant="outlined" />
        <StatTile label="Open tasks" value={openTasks} variant="outlined" />
        <StatTile label="Overdue tasks" value={overdue.length} variant={overdue.length ? "accent" : "outlined"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border bg-card p-5">
          <h2 className="mb-4 text-lg font-semibold">Pipeline value by stage</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStage} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="stage" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis width={56} tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="value" name="Value" radius={[10, 10, 0, 0]}>
                  {byStage.map((s) => <Cell key={s.stage} fill={stageColor[s.stage]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border bg-card p-5">
          <h2 className="mb-4 text-lg font-semibold">Deals won per month</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis width={32} allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number, _n, p) => [`${v} won (${fmtMoney(p.payload.value)})`, "Deals"]} />
                <Bar dataKey="won" name="Won" fill="hsl(var(--success))" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5 text-warning" /> Overdue tasks
          </h2>
          <Button asChild variant="ghost" size="sm" className="rounded-full"><Link to="/tasks">All tasks</Link></Button>
        </div>
        {overdue.length === 0 ? (
          <EmptyState title="Nothing overdue" description="Every open task is on time. Nice." variant="plain" size="compact" />
        ) : (
          <ul className="divide-y">
            {overdue.slice(0, 8).map((t) => {
              const days = Math.round((new Date(today).getTime() - new Date(t.due_date!).getTime()) / 86400000);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="shrink-0 text-warning-foreground">
                    <span className="rounded-full bg-warning/20 px-2.5 py-0.5 text-xs font-medium text-foreground">{days}d late · due {fmtDate(t.due_date!)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default Index;
