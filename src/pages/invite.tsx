import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { acceptBoardInvite } from "@/lib/invites.functions";
import { toast } from "sonner";

export default function InvitePage() {
  const { token = "" } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      try { localStorage.setItem("pendingInviteToken", token); } catch {}
      navigate(`/signup?invite=${encodeURIComponent(token)}`);
      return;
    }
    if (ran.current) return;
    ran.current = true;
    acceptBoardInvite({ token })
      .then((res) => {
        try { localStorage.removeItem("pendingInviteToken"); } catch {}
        toast.success("You've joined the board");
        navigate(`/boards/${res.boardId}`);
      })
      .catch((e: any) => setError(e.message ?? "Failed to accept invite"));
  }, [user, loading, token, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => navigate("/boards")}>Go to boards</Button>
          </>
        ) : (
          <><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Joining board…</p></>
        )}
      </div>
    </div>
  );
}
