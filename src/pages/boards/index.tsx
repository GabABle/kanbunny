import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Download, Upload } from "lucide-react";
import { createBoard, deleteBoard, listBoards, exportBoard, importBoard } from "@/lib/kanban.functions";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

const G = ["linear-gradient(135deg,#6366f1,#ec4899)","linear-gradient(135deg,#0ea5e9,#22d3ee)","linear-gradient(135deg,#f59e0b,#ef4444)","linear-gradient(135deg,#10b981,#3b82f6)","linear-gradient(135deg,#8b5cf6,#6366f1)","linear-gradient(135deg,#f43f5e,#f97316)","linear-gradient(135deg,#14b8a6,#84cc16)","linear-gradient(135deg,#a855f7,#ec4899)"];
const fallbackGrad = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return G[h % G.length]; };
const grad = (b: { id: string; background_gradient?: string | null }) =>
  (b as any).background_gradient ?? fallbackGrad(b.id);

export default function BoardsListPage() {
  const confirmDlg = useConfirm();
  const { data: boards, isPending } = useQuery({ queryKey: ["boards"], queryFn: () => listBoards(), staleTime: 60_000 });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [exportingId, setExportingId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const createMut = useMutation({
    mutationFn: (v: { title: string; description?: string }) => createBoard(v),
    onSuccess: (board) => { qc.invalidateQueries({ queryKey: ["boards"] }); setOpen(false); setTitle(""); setDesc(""); navigate(`/boards/${board.id}`); },
    onError: (e) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteBoard({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
    onError: (e) => toast.error(e.message),
  });
  const importMut = useMutation({
    mutationFn: (json: any) => importBoard(json),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      toast.success("Board imported successfully");
      navigate(`/boards/${board.id}`);
    },
    onError: (e) => toast.error(`Import failed: ${e.message}`),
  });

  const handleExport = async (e: React.MouseEvent, boardId: string, boardTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setExportingId(boardId);
    try {
      const data = await exportBoard({ id: boardId });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${boardTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_flowjoe.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`"${boardTitle}" exported`);
    } catch (err: any) {
      toast.error(err.message ?? "Export failed");
    } finally {
      setExportingId(null);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so same file can be re-imported
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (!json.board || !json.lists) {
          toast.error("Invalid board file — not a Flowjoe export");
          return;
        }
        importMut.mutate(json);
      } catch {
        toast.error("Could not parse file — make sure it's a valid Flowjoe JSON export");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your boards</h1>
          <p className="mt-1 text-sm text-muted-foreground">{boards?.length ?? 0} {(boards?.length ?? 0) === 1 ? "board" : "boards"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importMut.isPending}
            title="Import a board from a JSON file"
          >
            <Upload className="h-4 w-4" />
            {importMut.isPending ? "Importing…" : "Import"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New board</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create board</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) createMut.mutate({ title: title.trim(), description: desc.trim() || undefined }); }} className="space-y-4">
                <Input autoFocus placeholder="Board title" value={title} onChange={(e) => setTitle(e.target.value)} />
                <Textarea placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
                <DialogFooter><Button type="submit" disabled={!title.trim() || createMut.isPending}>{createMut.isPending ? "Creating…" : "Create"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isPending && !boards ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-24 animate-pulse rounded-lg border border-border/60 bg-card" />))}</div>
      ) : (boards?.length ?? 0) === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border/60 p-12 text-center"><p className="text-sm text-muted-foreground">No boards yet. Create your first one to get started.</p></div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards!.map((b) => (
            <Link key={b.id} to={`/boards/${b.id}`} className="group relative block overflow-hidden rounded-lg border border-border/60 p-4 text-white shadow-sm transition hover:border-border hover:shadow-md" style={{ backgroundImage: grad(b) }}>
              <h3 className="font-medium tracking-tight drop-shadow">{b.title}</h3>
              {b.description && <p className="mt-1 line-clamp-2 text-sm text-white/85">{b.description}</p>}
              {/* Action buttons — stacked vertically top-right */}
              <div className="absolute right-2 top-2 flex flex-col gap-1">
                <button
                  onClick={async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirmDlg({ title: `Delete "${b.title}"?`, destructive: true, confirmText: "Delete" })) delMut.mutate(b.id); }}
                  className="rounded-md bg-black/30 p-1.5 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Delete board"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => handleExport(e, b.id, b.title)}
                  disabled={exportingId === b.id}
                  className="rounded-md bg-black/30 p-1.5 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/50 disabled:opacity-50"
                  aria-label="Export board as JSON"
                  title="Export board as JSON"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
