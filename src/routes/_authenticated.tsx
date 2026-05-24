import { createFileRoute, Outlet, Link, useNavigate, useLocation, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutGrid, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <Link to="/boards" className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <LayoutGrid className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Kanbunny</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Button asChild variant={location.pathname === "/boards" ? "secondary" : "ghost"} size="sm">
              <Link to="/boards">Boards</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { navigate({ to: "/" }); void signOut(); }}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </nav>
        </div>
      </header>
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}