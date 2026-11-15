import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { LOGO } from "@/components/AppShell";

const SignIn = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextRaw = params.get("next") ?? "/";
  const next = nextRaw.startsWith("/") ? nextRaw : "/";

  if (!loading && user) return <Navigate replace to={next} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return setError("Sign-in is not set up yet.");
    setBusy(true);
    setError("");
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.code === "invalid_credentials" ? "That email and password don't match." : error.message);
      else navigate(next, { replace: true });
    } else {
      if (name.trim().length < 2) {
        setBusy(false);
        return setError("Please enter your name (at least 2 characters).");
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/`, data: { display_name: name.trim() } },
      });
      if (error) {
        setError(
          error.code === "weak_password" ? "Please choose a longer password." :
          error.code === "user_already_exists" || error.code === "email_exists" ? "That email already has an account. Sign in instead." :
          error.message,
        );
      } else if (data.session) navigate(next, { replace: true });
      else setError("Account created. Please sign in.");
    }
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <img src={LOGO} alt="Northwind CRM logo" className="h-10 w-10 rounded-lg" />
          <span className="font-display text-xl font-semibold text-white">Northwind CRM</span>
        </div>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight text-white">Every contact, deal and follow-up in one place.</p>
          <p className="mt-4 max-w-md text-sidebar-foreground/80">Move deals across the pipeline, keep tasks on time, and see who changed what.</p>
        </div>
        <div className="flex gap-2">
          {["Lead", "Qualified", "Proposal", "Won"].map((s, i) => (
            <div key={s} className="flex-1 rounded-2xl border border-sidebar-border p-3 text-sm">
              <div className="mb-2 h-1.5 rounded-full bg-sidebar-primary" style={{ opacity: 0.35 + i * 0.22 }} />
              {s}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <img src={LOGO} alt="Northwind CRM logo" className="h-11 w-11 rounded-xl lg:hidden" />
          <div>
            <h1 className="text-3xl font-semibold">Welcome to Northwind CRM</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "in" ? "Sign in with your team account." : "Create your account. The first account becomes the admin; later ones wait for an admin to approve them."}
            </p>
          </div>
          {mode === "up" && (
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className="rounded-xl" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required className="rounded-xl" />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full rounded-full">
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "in" ? "New to the team?" : "Already have an account?"}{" "}
            <button type="button" className="font-medium text-primary underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}>
              {mode === "in" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default SignIn;
