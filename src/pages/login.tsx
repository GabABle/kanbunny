import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { acceptBoardInvite } from "@/lib/invites.functions";
import logo from "@/assets/logo.png";

export default function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("pendingInviteToken") : null;
    if (token) {
      acceptBoardInvite({ token })
        .then((res) => { try { localStorage.removeItem("pendingInviteToken"); } catch {} navigate(`/boards/${res.boardId}`); })
        .catch(() => navigate("/boards"));
    } else navigate("/boards");
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate("/boards");
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      {busy && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Signing you in…</p></div>
        </div>
      )}
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-col items-center gap-2">
          <img src={logo} alt="Flowjoe" className="h-12 w-12 rounded-xl" />
          <span className="text-sm font-semibold tracking-tight">Flowjoe</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-center">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground text-center">Sign in to your boards.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">No account? <Link to="/signup" className="text-foreground underline-offset-4 hover:underline">Sign up</Link></p>
      </div>
    </div>
  );
}
