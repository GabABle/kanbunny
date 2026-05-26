import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { acceptBoardInvite } from "@/lib/invites.functions";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — Flowjoe" }] }),
  validateSearch: (s: Record<string, unknown>): { invite?: string } =>
    typeof s.invite === "string" ? { invite: s.invite } : {},
  component: SignupPage,
});

function SignupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const acceptFn = useServerFn(acceptBoardInvite);
  const inviteToken = search.invite ?? (typeof window !== "undefined" ? localStorage.getItem("pendingInviteToken") ?? undefined : undefined);
  useEffect(() => { if (inviteToken) try { localStorage.setItem("pendingInviteToken", inviteToken); } catch {} }, [inviteToken]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (inviteToken) {
      acceptFn({ data: { token: inviteToken } })
        .then((res) => {
          try { localStorage.removeItem("pendingInviteToken"); } catch {}
          navigate({ to: "/boards/$boardId", params: { boardId: res.boardId } });
        })
        .catch(() => navigate({ to: "/boards" }));
    } else {
      navigate({ to: "/boards" });
    }
  }, [user, inviteToken, navigate, acceptFn]);

  useEffect(() => {
    router.preloadRoute({ to: "/login" });
    router.preloadRoute({ to: "/boards" });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const redirectPath = inviteToken ? `/invite/${inviteToken}` : "/boards";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + redirectPath,
        data: { display_name: name },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      if (inviteToken) {
        try {
          const res = await acceptFn({ data: { token: inviteToken } });
          try { localStorage.removeItem("pendingInviteToken"); } catch {}
          navigate({ to: "/boards/$boardId", params: { boardId: res.boardId } });
          return;
        } catch { /* fall through */ }
      }
      navigate({ to: "/boards" });
    } else {
      toast.success("Check your email to confirm your account before signing in.");
      navigate({ to: "/login" });
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-col items-center gap-2">
          <img src={logo} alt="Flowjoe" className="h-12 w-12 rounded-xl" />
          <span className="text-sm font-semibold tracking-tight">Flowjoe</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start building boards in seconds.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Have an account? <Link to="/login" className="text-foreground underline-offset-4 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}