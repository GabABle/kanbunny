import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, MoreHorizontal, Trash2, UserPlus, X } from "lucide-react";
import {
  getBoard, createList, renameList, deleteList,
  createCard, updateCard, deleteCard, moveCard,
  inviteMember, removeMember,
} from "@/lib/kanban.functions";
import { toast } from "sonner";

const boardQO = (id: string) =>
  queryOptions({ queryKey: ["board", id], queryFn: () => getBoard({ data: { id } }) });

export const Route = createFileRoute("/_authenticated/boards/$boardId")({
  head: () => ({ meta: [{ title: "Board — Stack" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(boardQO(params.boardId)),
  errorComponent: ({ error }) => (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <p className="text-sm text-destructive">{error.message}</p>
        <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/boards">Back to boards</Link></Button>
      </div>
    </div>
  ),
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = Route.useParams();
  const { data } = useSuspenseQuery(boardQO(boardId));
  const qc = useQueryClient();
  const canEdit = data.role === "owner" || data.role === "editor";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  const createListFn = useServerFn(createList);
  const renameListFn = useServerFn(renameList);
  const deleteListFn = useServerFn(deleteList);
  const createCardFn = useServerFn(createCard);
  const updateCardFn = useServerFn(updateCard);
  const deleteCardFn = useServerFn(deleteCard);
  const moveCardFn = useServerFn(moveCard);

  const createListMut = useMutation({ mutationFn: (title: string) => createListFn({ data: { boardId, title } }), onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const renameListMut = useMutation({ mutationFn: (v: { id: string; title: string }) => renameListFn({ data: v }), onSuccess: invalidate });
  const deleteListMut = useMutation({ mutationFn: (id: string) => deleteListFn({ data: { id } }), onSuccess: invalidate });
  const createCardMut = useMutation({ mutationFn: (v: { listId: string; title: string }) => createCardFn({ data: v }), onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const updateCardMut = useMutation({ mutationFn: (v: any) => updateCardFn({ data: v }), onSuccess: invalidate });
  const deleteCardMut = useMutation({ mutationFn: (id: string) => deleteCardFn({ data: { id } }), onSuccess: invalidate });
  const moveCardMut = useMutation({ mutationFn: (v: { id: string; listId: string; position: number }) => moveCardFn({ data: v }), onSuccess: invalidate });

  const [newListTitle, setNewListTitle] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const openedCard = data.cards.find((c) => c.id === openCard);

  const cardsByList = (listId: string) => data.cards.filter((c) => c.list_id === listId).sort((a, b) => a.position - b.position);

  const moveCardTo = (cardId: string, targetListId: string) => {
    const targetCards = cardsByList(targetListId);
    const lastPos = targetCards[targetCards.length - 1]?.position ?? 0;
    moveCardMut.mutate({ id: cardId, listId: targetListId, position: lastPos + 1000 });
  };

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{data.board.title}</h1>
          {data.board.description && <p className="text-xs text-muted-foreground">{data.board.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <MembersPopover boardId={boardId} members={data.members} isOwner={data.role === "owner"} onChange={invalidate} />
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full items-start gap-3 p-4">
          {data.lists.sort((a, b) => a.position - b.position).map((list) => (
            <div key={list.id} className="flex w-72 flex-none flex-col rounded-lg border border-border/60 bg-card">
              <div className="flex items-center justify-between px-3 py-2">
                <InlineRename
                  value={list.title}
                  disabled={!canEdit}
                  onSave={(t) => renameListMut.mutate({ id: list.id, title: t })}
                  className="flex-1 text-sm font-medium"
                />
                {canEdit && (
                  <button
                    onClick={() => confirm("Delete this list and all its cards?") && deleteListMut.mutate(list.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Delete list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cardsByList(list.id).map((card) => (
                  <div
                    key={card.id}
                    onClick={() => setOpenCard(card.id)}
                    className="cursor-pointer rounded-md border border-border/60 bg-background p-2 text-sm transition hover:border-border"
                  >
                    <div className="font-medium">{card.title}</div>
                    {card.description && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.description}</div>}
                    {canEdit && data.lists.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                        {data.lists.filter((l) => l.id !== list.id).map((l) => (
                          <button
                            key={l.id}
                            onClick={() => moveCardTo(card.id, l.id)}
                            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            → {l.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {canEdit && <NewCardForm onAdd={(title) => createCardMut.mutate({ listId: list.id, title })} />}
              </div>
            </div>
          ))}

          {canEdit && (
            <div className="w-72 flex-none">
              <form
                onSubmit={(e) => { e.preventDefault(); if (newListTitle.trim()) { createListMut.mutate(newListTitle.trim()); setNewListTitle(""); } }}
                className="flex gap-2 rounded-lg border border-dashed border-border/60 p-2"
              >
                <Input value={newListTitle} onChange={(e) => setNewListTitle(e.target.value)} placeholder="New list" className="h-8" />
                <Button type="submit" size="sm" variant="secondary"><Plus className="h-4 w-4" /></Button>
              </form>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!openedCard} onOpenChange={(o) => !o && setOpenCard(null)}>
        <DialogContent className="max-w-lg">
          {openedCard && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <InlineRename value={openedCard.title} disabled={!canEdit} onSave={(t) => updateCardMut.mutate({ id: openedCard.id, title: t })} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Textarea
                  defaultValue={openedCard.description ?? ""}
                  disabled={!canEdit}
                  placeholder="Add a description…"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (openedCard.description ?? "")) updateCardMut.mutate({ id: openedCard.id, description: v || null });
                  }}
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    disabled={!canEdit}
                    defaultValue={openedCard.due_date ? new Date(openedCard.due_date).toISOString().slice(0, 16) : ""}
                    onChange={(e) => updateCardMut.mutate({ id: openedCard.id, due_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    className="max-w-xs"
                  />
                </div>
              </div>
              <DialogFooter>
                {canEdit && (
                  <Button variant="destructive" size="sm" onClick={() => { deleteCardMut.mutate(openedCard.id); setOpenCard(null); }}>
                    <Trash2 className="h-4 w-4" /> Delete card
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InlineRename({ value, onSave, disabled, className }: { value: string; onSave: (v: string) => void; disabled?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (disabled || !editing) {
    return <button disabled={disabled} onClick={() => { setV(value); setEditing(true); }} className={"text-left " + (className ?? "")}>{value}</button>;
  }
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { setEditing(false); if (v.trim() && v !== value) onSave(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className={"rounded border border-border bg-background px-1 py-0.5 outline-none " + (className ?? "")}
    />
  );
}

function NewCardForm({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        <Plus className="h-3.5 w-3.5" /> Add card
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onAdd(title.trim()); setTitle(""); setOpen(false); } }}
      className="flex flex-col gap-2"
    >
      <Textarea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title" className="min-h-[60px] text-sm" />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Add</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setTitle(""); }}><X className="h-4 w-4" /></Button>
      </div>
    </form>
  );
}

function MembersPopover({ boardId, members, isOwner, onChange }: { boardId: string; members: any[]; isOwner: boolean; onChange: () => void }) {
  const inviteFn = useServerFn(inviteMember);
  const removeFn = useServerFn(removeMember);
  const [email, setEmail] = useState("");
  const inviteMut = useMutation({
    mutationFn: () => inviteFn({ data: { boardId, email, role: "editor" } }),
    onSuccess: () => { toast.success("Member added"); setEmail(""); onChange(); },
    onError: (e) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (userId: string) => removeFn({ data: { boardId, userId } }),
    onSuccess: onChange, onError: (e) => toast.error(e.message),
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><UserPlus className="h-4 w-4" /> Members ({members.length})</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div className="text-sm font-medium">Board members</div>
          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between rounded px-2 py-1 text-sm">
                <div>
                  <div>{m.profile?.display_name ?? m.profile?.email ?? "User"}</div>
                  <div className="text-xs text-muted-foreground">{m.role}</div>
                </div>
                {isOwner && m.role !== "owner" && (
                  <button onClick={() => removeMut.mutate(m.user_id)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {isOwner && (
            <form onSubmit={(e) => { e.preventDefault(); if (email) inviteMut.mutate(); }} className="flex gap-2 border-t border-border/60 pt-3">
              <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-8" />
              <Button type="submit" size="sm" disabled={inviteMut.isPending}>Invite</Button>
            </form>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
