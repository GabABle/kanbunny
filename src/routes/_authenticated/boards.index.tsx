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

export const Route = createFileRoute("/_authenticated/boards/")({
  head: () => ({ meta: [{ title: "Your boards — Stack" }] }),
  component: BoardsPage,
});

function BoardsPage() {
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
            <div key={b.id} className="group relative rounded-lg border border-border/60 bg-card p-4 transition hover:border-border">
              <Link to="/boards/$boardId" params={{ boardId: b.id }} className="block">
                <h3 className="font-medium tracking-tight">{b.title}</h3>
                {b.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{b.description}</p>}
              </Link>
              <button
                onClick={() => confirm(`Delete "${b.title}"?`) && delMut.mutate(b.id)}
                className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}