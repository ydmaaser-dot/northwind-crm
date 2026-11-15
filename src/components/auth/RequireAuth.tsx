import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-sidebar text-sidebar-foreground">
        <img src="/assets/7ae2c827-a6ca-4e50-818a-803efe20c9ca.png" alt="Northwind CRM logo" className="h-14 w-14 rounded-xl" />
        <h1 className="font-display text-2xl font-semibold text-white">Northwind CRM</h1>
        <p className="text-sm">Opening your workspace…</p>
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate replace to={`/sign-in?next=${next}`} />;
  }
  return <>{children}</>;
}
