import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, BarChart3, CheckSquare, Handshake, LayoutDashboard, LogOut, Menu, Users, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/blocks";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/crm";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ThemeToggle";

export const LOGO = "/assets/7ae2c827-a6ca-4e50-818a-803efe20c9ca.png";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/deals", label: "Deals", icon: Handshake },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/activity", label: "Activity", icon: Activity },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin, profile } = useMe();
  const navigate = useNavigate();
  const all = isAdmin ? [...items, { to: "/team", label: "Team", icon: UserCog }] : items;
  const signOut = async () => {
    await supabase?.auth.signOut();
    navigate("/sign-in");
  };
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 py-6">
        <img src={LOGO} alt="Northwind CRM logo" className="h-9 w-9 rounded-lg" />
        <span className="font-display text-lg font-semibold text-white">Northwind CRM</span>
      </Link>
      <nav className="flex-1 space-y-1 px-3">
        {all.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <i.icon className="h-4 w-4" />
            {i.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <p className="truncate text-sm font-medium text-white">{profile?.display_name ?? "Signed in"}</p>
        <p className="mb-3 text-xs capitalize text-sidebar-foreground/70">{profile?.role ?? ""}</p>
        <Button variant="outline" size="sm" className="w-full rounded-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-white" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const { isPending, loading, profile } = useMe();
  const navigate = useNavigate();

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;

  if (isPending || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-3xl border bg-card p-8 text-center">
          <img src={LOGO} alt="Northwind CRM logo" className="mx-auto h-12 w-12 rounded-xl" />
          <h1 className="text-2xl font-semibold">Waiting for approval</h1>
          <p className="text-muted-foreground">
            Your account is created. An admin needs to approve it before you can see the team's contacts, deals and tasks. Check back soon.
          </p>
          <Button
            className="rounded-full"
            onClick={async () => {
              await supabase?.auth.signOut();
              navigate("/sign-in");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Nav />
      </aside>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-sidebar px-4 py-3 lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <img src={LOGO} alt="Northwind CRM logo" className="h-8 w-8 rounded-md" />
          <span className="font-display font-semibold text-white">Northwind CRM</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle className="text-white hover:bg-sidebar-accent hover:text-white" />
          <Button variant="ghost" size="icon" className="text-white hover:bg-sidebar-accent hover:text-white" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <header className="sticky top-0 z-30 hidden items-center justify-end border-b bg-background/95 px-8 py-2 backdrop-blur lg:flex">
        <ThemeToggle />
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-0 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Nav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="mx-auto max-w-7xl p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
