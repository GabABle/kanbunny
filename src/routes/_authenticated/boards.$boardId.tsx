import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, UserPlus, X, Clock } from "lucide-react";
import {
  getBoard, createList, renameList, deleteList,
  createCard, updateCard, deleteCard, moveCard,
  inviteMember, removeMember,
} from "@/lib/kanban.functions";
import { toast } from "sonner";
import { CardDialog } from "@/components/kanban/CardDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/boards/$boardId")({
  head: () => ({ meta: [{ title: "Board — Stack" }] }),
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

type BoardData = Awaited<ReturnType<typeof getBoard>>;

function BoardPage() {
  const { boardId } = Route.useParams();
  const getBoardFn = useServerFn(getBoard);
  const qc = useQueryClient();
  const key = ["board", boardId] as const;
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => getBoardFn({ data: { id: boardId } }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const patch = (fn: (d: BoardData) => BoardData) =>
    qc.setQueryData<BoardData>(key, (old) => (old ? fn(old) : old));

  const createListFn = useServerFn(createList);
  const renameListFn = useServerFn(renameList);
  const deleteListFn = useServerFn(deleteList);
  const createCardFn = useServerFn(createCard);
  const updateCardFn = useServerFn(updateCard);
  const deleteCardFn = useServerFn(deleteCard);
  const moveCardFn = useServerFn(moveCard);

  const tmpId = () => `tmp-${Math.random().toString(36).slice(2)}`;

  const createListMut = useMutation({
    mutationFn: (title: string) => createListFn({ data: { boardId, title } }),
    onMutate: async (title) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      const id = tmpId();
      const lastPos = prev?.lists.reduce((m, l) => Math.max(m, l.position), 0) ?? 0;
      patch((d) => ({ ...d, lists: [...d.lists, { id, board_id: boardId, title, position: lastPos + 1000 } as any] }));
      return { prev, id };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSuccess: (real, _v, ctx) => patch((d) => ({ ...d, lists: d.lists.map((l) => (l.id === ctx?.id ? real as any : l)) })),
  });
  const renameListMut = useMutation({
    mutationFn: (v: { id: string; title: string }) => renameListFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, lists: d.lists.map((l) => (l.id === v.id ? { ...l, title: v.title } : l)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const deleteListMut = useMutation({
    mutationFn: (id: string) => deleteListFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== id), cards: d.cards.filter((c) => c.list_id !== id) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const createCardMut = useMutation({
    mutationFn: (v: { listId: string; title: string }) => createCardFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      const id = tmpId();
      const lastPos = prev?.cards.filter((c) => c.list_id === v.listId).reduce((m, c) => Math.max(m, c.position), 0) ?? 0;
      patch((d) => ({ ...d, cards: [...d.cards, { id, list_id: v.listId, title: v.title, description: null, due_date: null, position: lastPos + 1000 } as any] }));
      return { prev, id };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSuccess: (real, _v, ctx) => patch((d) => ({ ...d, cards: d.cards.map((c) => (c.id === ctx?.id ? real as any : c)) })),
  });
  const updateCardMut = useMutation({
    mutationFn: (v: any) => updateCardFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.map((c) => (c.id === v.id ? { ...c, ...v } : c)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const deleteCardMut = useMutation({
    mutationFn: (id: string) => deleteCardFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const moveCardMut = useMutation({
    mutationFn: (v: { id: string; listId: string; position: number }) => moveCardFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.map((c) => (c.id === v.id ? { ...c, list_id: v.listId, position: v.position } : c)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });

  const [newListTitle, setNewListTitle] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);

  if (isLoading || !data) {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">Loading…</div>;
  }
  const canEdit = data.role === "owner" || data.role === "editor";
  const openedCard = data.cards.find((c) => c.id === openCard);
  const openedList = openedCard ? data.lists.find((l) => l.id === openedCard.list_id) : null;

  const cardsByList = (listId: string) => data.cards.filter((c) => c.list_id === listId).sort((a, b) => a.position - b.position);

  const moveCardTo = (cardId: string, targetListId: string) => {
    const targetCards = cardsByList(targetListId);
    const lastPos = targetCards[targetCards.length - 1]?.position ?? 0;
    moveCardMut.mutate({ id: cardId, listId: targetListId, position: lastPos + 1000 });
  };

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col bg-board text-board-foreground">
      <div className="flex items-center justify-between bg-board-bar px-4 py-2 backdrop-blur">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-board-foreground">{data.board.title}</h1>
          {data.board.description && <p className="text-xs text-board-foreground/70">{data.board.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <MembersPopover boardId={boardId} members={data.members} isOwner={data.role === "owner"} onChange={invalidate} />
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full items-start gap-3 p-4">
          {data.lists.sort((a, b) => a.position - b.position).map((list) => (
            <div
              key={list.id}
              className="flex w-72 flex-none flex-col rounded-xl bg-list text-list-foreground shadow-sm max-h-full"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => {
                e.preventDefault();
                const cardId = e.dataTransfer.getData("text/card-id");
                if (cardId) moveCardTo(cardId, list.id);
              }}
            >
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <InlineRename
                  value={list.title}
                  disabled={!canEdit}
                  onSave={(t) => renameListMut.mutate({ id: list.id, title: t })}
                  className="flex-1 text-sm font-semibold"
                />
                {canEdit && (
                  <button
                    onClick={() => confirm("Delete this list and all its cards?") && deleteListMut.mutate(list.id)}
                    className="rounded p-1 text-list-muted hover:bg-black/5 hover:text-list-foreground"
                    aria-label="Delete list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cardsByList(list.id).map((card) => (
                  <CardFront
                    key={card.id}
                    card={card}
                    data={data}
                    canEdit={canEdit}
                    onOpen={() => setOpenCard(card.id)}
                    onMove={(toListId) => moveCardTo(card.id, toListId)}
                    listId={list.id}
                  />
                ))}
                {canEdit && <NewCardForm onAdd={(title) => createCardMut.mutate({ listId: list.id, title })} />}
              </div>
            </div>
          ))}

          {canEdit && (
            <div className="w-72 flex-none">
              <NewListForm value={newListTitle} setValue={setNewListTitle} onAdd={(t) => { createListMut.mutate(t); setNewListTitle(""); }} />
            </div>
          )}
        </div>
      </div>

      {openedCard && openedList && (
        <CardDialog
          card={openedCard as any}
          listTitle={openedList.title}
          boardId={boardId}
          canEdit={canEdit}
          labels={data.labels as any}
          cardLabels={data.cardLabels as any}
          assignees={data.assignees as any}
          members={data.members as any}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

function CardFront({ card, data, canEdit, onOpen, onMove, listId }: {
  card: any; data: any; canEdit: boolean; onOpen: () => void; onMove: (toListId: string) => void; listId: string;
}) {
  const labelIds = new Set(data.cardLabels.filter((cl: any) => cl.card_id === card.id).map((cl: any) => cl.label_id));
  const myLabels = data.labels.filter((l: any) => labelIds.has(l.id));
  const assigneeIds = new Set(data.assignees.filter((a: any) => a.card_id === card.id).map((a: any) => a.user_id));
  const myMembers = data.members.filter((m: any) => assigneeIds.has(m.user_id));
  const dueDate = card.due_date ? new Date(card.due_date) : null;
  const overdue = dueDate ? dueDate.getTime() < Date.now() : false;

  return (
    <div
      onClick={onOpen}
      className="cursor-pointer rounded-md bg-tcard text-tcard-foreground p-2 text-sm shadow-sm hover:ring-2 hover:ring-primary/40 transition"
    >
      {myLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {myLabels.map((l: any) => (
            <span key={l.id} className="h-2 w-10 rounded-full" style={{ backgroundColor: l.color }} title={l.name} />
          ))}
        </div>
      )}
      <div className="font-medium">{card.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-list-muted">
        {dueDate && (
          <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", overdue && "bg-destructive/15 text-destructive")}>
            <Clock className="h-3 w-3" />
            {dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        {card.description && (
          <span title="Has description" className="inline-flex"><span className="text-[10px]">≡</span></span>
        )}
        <span className="ml-auto flex -space-x-1.5">
          {myMembers.slice(0, 3).map((m: any) => {
            const name = m.profile?.display_name ?? m.profile?.email ?? "?";
            return (
              <span key={m.user_id} className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-tcard" title={name}>
                {name.slice(0, 1).toUpperCase()}
              </span>
            );
          })}
        </span>
      </div>
      {canEdit && data.lists.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {data.lists.filter((l: any) => l.id !== listId).map((l: any) => (
            <button
              key={l.id}
              onClick={() => onMove(l.id)}
              className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-list-muted hover:bg-black/10 hover:text-list-foreground"
            >
              → {l.title}
            </button>
          ))}
        </div>
      )}
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
      <button onClick={() => setOpen(true)} className="mt-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-list-muted hover:bg-black/5 hover:text-list-foreground">
        <Plus className="h-3.5 w-3.5" /> Add a card
      </button>
    );
  }
  const submit = () => { if (title.trim()) { onAdd(title.trim()); setTitle(""); setOpen(false); } };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex flex-col gap-2"
    >
      <Textarea
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") { setOpen(false); setTitle(""); } }}
        placeholder="Enter a title for this card…"
        className="min-h-[60px] bg-tcard text-tcard-foreground text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Add card</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setTitle(""); }}><X className="h-4 w-4" /></Button>
      </div>
    </form>
  );
}

function NewListForm({ value, setValue, onAdd }: { value: string; setValue: (v: string) => void; onAdd: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1 rounded-xl bg-white/20 px-3 py-2 text-sm text-board-foreground hover:bg-white/30"
      >
        <Plus className="h-4 w-4" /> Add another list
      </button>
    );
  }
  const submit = () => { if (value.trim()) { onAdd(value.trim()); setOpen(false); } };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex flex-col gap-2 rounded-xl bg-list p-2 text-list-foreground"
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setValue(""); } }}
        placeholder="Enter list title…"
        className="h-8 bg-tcard text-tcard-foreground"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Add list</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setValue(""); }}><X className="h-4 w-4" /></Button>
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
