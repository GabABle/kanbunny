import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { createBoard, deleteBoard, listBoards } from "@/lib/kanban.functions";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

const BOARD_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #ec4899)",
  "linear-gradient(135deg, #0ea5e9, #22d3ee)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #10b981, #3b82f6)",
  "linear-gradient(135deg, #8b5cf6, #6366f1)",
  "linear-gradient(135deg, #f43f5e, #f97316)",
  "linear-gradient(135deg, #14b8a6, #84cc16)",
  "linear-gradient(135deg, #a855f7, #ec4899)",
  "linear-gradient(135deg, #0f766e, #0ea5e9)",
  "linear-gradient(135deg, #1e3a8a, #7c3aed)",
];
function gradientFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BOARD_GRADIENTS[h % BOARD_GRADIENTS.length];
}

export const Route = createFileRoute("/_authenticated/boards/")({
  head: () => ({ meta: [{ title: "Your boards — Kanbunny" }] }),
  component: BoardsPage,
});

function BoardsPage() {
  const confirmDlg = useConfirm();
  const list = useServerFn(listBoards);
  const { data: boards, isPending } = useQuery({
    queryKey: ["boards"],
    queryFn: () => list(),
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(createBoard);
  const del = useServerFn(deleteBoard);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const createMut = useMutation({
    mutationFn: (vars: { title: string; description?: string }) => create({ data: vars }),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      setOpen(false); setTitle(""); setDesc("");
      navigate({ to: "/boards/$boardId", params: { boardId: board.id } });
    },
    onError: (e) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your boards</h1>
          <p className="mt-1 text-sm text-muted-foreground">{boards?.length ?? 0} {(boards?.length ?? 0) === 1 ? "board" : "boards"}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New board</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create board</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); if (title.trim()) createMut.mutate({ title: title.trim(), description: desc.trim() || undefined }); }}
              className="space-y-4"
            >
              <Input autoFocus placeholder="Board title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <DialogFooter>
                <Button type="submit" disabled={!title.trim() || createMut.isPending}>{createMut.isPending ? "Creating…" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isPending && !boards ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border/60 bg-card" />
          ))}
        </div>
      ) : (boards?.length ?? 0) === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border/60 p-12 text-center">
          <p className="text-sm text-muted-foreground">No boards yet. Create your first one to get started.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards!.map((b) => (
            <div
              key={b.id}
              className="group relative overflow-hidden rounded-lg border border-border/60 p-4 text-white shadow-sm transition hover:border-border hover:shadow-md"
              style={{ backgroundImage: gradientFor(b.id) }}
            >
              <Link to="/boards/$boardId" params={{ boardId: b.id }} className="block">
                <h3 className="font-medium tracking-tight drop-shadow">{b.title}</h3>
                {b.description && <p className="mt-1 line-clamp-2 text-sm text-white/85">{b.description}</p>}
              </Link>
              <button
                onClick={async () => { if (await confirmDlg({ title: `Delete "${b.title}"?`, destructive: true, confirmText: "Delete" })) delMut.mutate(b.id); }}
                className="absolute right-2 top-2 rounded-md bg-black/30 p-1.5 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/50"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}