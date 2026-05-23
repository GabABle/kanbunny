import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Users, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stack — Modern Kanban for fast teams" },
      { name: "description", content: "A clean, collaborative kanban board. Boards, lists, cards, drag-and-drop, and team workflows." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && user) navigate({ to: "/boards" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">Stack</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-semibold tracking-tight">A kanban that gets out of your way.</h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Boards, lists, and cards with the speed of a desktop app. Built for product teams that move fast.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Create your first board</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>
        <div className="mt-24 grid gap-8 sm:grid-cols-3">
          {[
            { icon: LayoutGrid, title: "Linear-fast", desc: "Optimistic updates and zero-loading interactions." },
            { icon: Users, title: "Collaborative", desc: "Invite teammates with editor or viewer access." },
            { icon: Zap, title: "Drag & drop", desc: "Reorder cards and lists with smooth physics." },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border/60 bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
