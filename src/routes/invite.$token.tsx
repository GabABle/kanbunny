import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { acceptBoardInvite } from "@/lib/invites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Join board — Flowjoe" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const accept = useServerFn(acceptBoardInvite);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Stash token & redirect to signup so a new account joins on confirm,
      // or login for existing users.
      try { localStorage.setItem("pendingInviteToken", token); } catch {}
      navigate({ to: "/signup", search: { invite: token } as any });
      return;
    }
    if (ran.current) return;
    ran.current = true;
    accept({ data: { token } })
      .then((res) => {
        try { localStorage.removeItem("pendingInviteToken"); } catch {}
        toast.success("You've joined the board");
        navigate({ to: "/boards/$boardId", params: { boardId: res.boardId } });
      })
      .catch((e) => setError(e.message ?? "Failed to accept invite"));
  }, [user, loading, token, navigate, accept]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => navigate({ to: "/boards" })}>Go to boards</Button>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Joining board…</p>
          </>
        )}
      </div>
    </div>
  );
}