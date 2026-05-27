import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, UserPlus, X, Clock, Bell, Filter, Link2, CalendarClock } from "lucide-react";
import {
  getBoard, createList, renameList, deleteList, moveList,
  createCard, updateCard, deleteCard, moveCard,
  inviteMember, removeMember, searchProfiles, renameBoard, updateBoardBackground,
} from "@/lib/kanban.functions";
import { createBoardInvite } from "@/lib/invites.functions";
import { toast } from "sonner";
import { CardDialog } from "@/components/kanban/CardDialog";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { colorFor } from "@/lib/avatar-color";

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
  "linear-gradient(135deg, #be185d, #f59e0b)",
  "linear-gradient(135deg, #064e3b, #0ea5e9)",
];
function randomGradient(exclude?: string | null) {
  const pool = BOARD_GRADIENTS.filter((g) => g !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

function UserFilterPopover({ members, selected, onChange }: { members: any[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={selected.size > 0 ? "default" : "outline"} size="sm">
          <Filter className="h-4 w-4" /> User{selected.size > 0 ? ` (${selected.size})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Filter by user</div>
            {selected.size > 0 && (
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => onChange(new Set())}>Clear</button>
            )}
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {members.map((m) => {
              const name = m.profile?.display_name ?? m.profile?.email ?? "User";
              const on = selected.has(m.user_id);
              return (
                <button
                  key={m.user_id}
                  onClick={() => toggle(m.user_id)}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent", on && "bg-accent")}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: colorFor(m) }}>
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">{name}</span>
                  {on && <span className="text-xs text-primary">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type BoardData = Awaited<ReturnType<typeof getBoard>>;

function BoardPage() {
  const { boardId } = useParams() as { boardId: string };
  const confirmDlg = useConfirm();
  const getBoardFn = getBoard;
  const qc = useQueryClient();
  const key = ["board", boardId] as const;
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getBoardFn({ id: boardId }),
    staleTime: 60_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const patch = (fn: (d: BoardData) => BoardData) =>
    qc.setQueryData<BoardData>(key, (old) => (old ? fn(old) : old));

  const createListFn = createList;
  const renameListFn = renameList;
  const deleteListFn = deleteList;
  const renameBoardFn = renameBoard;
  const updateBgFn = updateBoardBackground;
  const createCardFn = createCard;
  const updateCardFn = updateCard;
  const deleteCardFn = deleteCard;
  const moveCardFn = moveCard;
  const moveListFn = moveList;

  const tmpId = () => `tmp-${Math.random().toString(36).slice(2)}`;

  const createListMut = useMutation({
    mutationFn: (title: string) => createListFn({ boardId, title }),
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
    mutationFn: (v: { id: string; title: string }) => renameListFn(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, lists: d.lists.map((l) => (l.id === v.id ? { ...l, title: v.title } : l)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const deleteListMut = useMutation({
    mutationFn: (id: string) => deleteListFn({ id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== id), cards: d.cards.filter((c) => c.list_id !== id) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const createCardMut = useMutation({
    mutationFn: (v: { listId: string; title: string }) => createCardFn(v),
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
    mutationFn: (v: any) => updateCardFn(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.map((c) => (c.id === v.id ? { ...c, ...v } : c)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const deleteCardMut = useMutation({
    mutationFn: (id: string) => deleteCardFn({ id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const moveCardMut = useMutation({
    mutationFn: (v: { id: string; listId: string; position: number }) => moveCardFn(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, cards: d.cards.map((c) => (c.id === v.id ? { ...c, list_id: v.listId, position: v.position } : c)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const moveListMut = useMutation({
    mutationFn: (v: { id: string; position: number }) => moveListFn(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, lists: d.lists.map((l) => (l.id === v.id ? { ...l, position: v.position } : l)) }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const renameBoardMut = useMutation({
    mutationFn: (title: string) => renameBoardFn({ id: boardId, title }),
    onMutate: async (title) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, board: { ...d.board, title } }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const updateBgMut = useMutation({
    mutationFn: (g: string) => updateBgFn({ id: boardId, background_gradient: g }),
    onMutate: async (g) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      patch((d) => ({ ...d, board: { ...d.board, background_gradient: g } as any }));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });

  const [newListTitle, setNewListTitle] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [sortModes, setSortModes] = useState<Record<string, "manual" | "date-asc">>({});
  const [filterUserIds, setFilterUserIds] = useState<Set<string>>(new Set());
  const [onlyChanged, setOnlyChanged] = useState(false);

  if (isLoading || !data) {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">Loading…</div>;
  }
  const canEdit = data.role === "owner" || data.role === "editor" || data.role === "member";
  const openedCard = data.cards.find((c) => c.id === openCard);
  const openedList = openedCard ? data.lists.find((l) => l.id === openedCard.list_id) : null;

  const changedSet = new Set<string>((data as any).recentlyChangedCardIds ?? []);
  const passesFilters = (card: any) => {
    if (onlyChanged && !changedSet.has(card.id)) return false;
    if (filterUserIds.size > 0) {
      if (!card.created_by || !filterUserIds.has(card.created_by)) return false;
    }
    return true;
  };
  const sortModeFor = (listId: string) => sortModes[listId] ?? "manual";
  const cycleSort = (listId: string) =>
    setSortModes((s) => ({ ...s, [listId]: (s[listId] ?? "manual") === "manual" ? "date-asc" : "manual" }));
  const cardsByList = (listId: string) => {
    const arr = data.cards.filter((c) => c.list_id === listId && passesFilters(c));
    const mode = sortModeFor(listId);
    if (mode === "manual") return arr.sort((a, b) => a.position - b.position);
    return arr.sort((a, b) => {
      const av = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
      const bv = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
      return av - bv;
    });
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    if (type === "LIST") {
      // Reorder lists
      const sorted = [...(data?.lists ?? [])].sort((a, b) => a.position - b.position);
      const withoutDragged = sorted.filter((l) => l.id !== draggableId);
      const idx = Math.min(Math.max(destination.index, 0), withoutDragged.length);
      const prev = withoutDragged[idx - 1]?.position;
      const next = withoutDragged[idx]?.position;
      let position: number;
      if (prev != null && next != null) position = (prev + next) / 2;
      else if (prev != null) position = prev + 1000;
      else if (next != null) position = next - 1000;
      else position = 1000;
      moveListMut.mutate({ id: draggableId, position });
      return;
    }

    const destListId = destination.droppableId;
    // Build the destination list as it currently is, excluding the dragged card
    const destCards = cardsByList(destListId).filter((c) => c.id !== draggableId);
    let position: number;
    if (sortModeFor(destListId) !== "manual") {
      const last = destCards[destCards.length - 1];
      position = (last?.position ?? 0) + 1000;
    } else {
      const idx = Math.min(Math.max(destination.index, 0), destCards.length);
      const prev = destCards[idx - 1]?.position;
      const next = destCards[idx]?.position;
      if (prev != null && next != null) position = (prev + next) / 2;
      else if (prev != null) position = prev + 1000;
      else if (next != null) position = next - 1000;
      else position = 1000;
    }
    moveCardMut.mutate({ id: draggableId, listId: destListId, position });
  };

  return (
    <div
      className="flex h-[calc(100vh-48px)] flex-col bg-board text-board-foreground"
      style={(data.board as any).background_gradient ? { backgroundImage: (data.board as any).background_gradient } : undefined}
    >
      <div className="flex items-center justify-between bg-black/20 px-4 py-2 backdrop-blur">
        <div>
          <InlineRename
            value={data.board.title}
            disabled={!canEdit}
            onSave={(t) => renameBoardMut.mutate(t)}
            className="text-base font-semibold tracking-tight text-board-foreground"
          />
          {data.board.description && <p className="text-xs text-board-foreground/70">{data.board.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateBgMut.mutate(randomGradient((data.board as any).background_gradient))}
              title="Change board background"
            >
              🎨 Get Funky
            </Button>
          )}
          <UserFilterPopover
            members={data.members as any}
            selected={filterUserIds}
            onChange={setFilterUserIds}
          />
          <Button
            variant={onlyChanged ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyChanged((v) => !v)}
            title="Show only cards with recent changes (last 7 days)"
          >
            <Bell className="h-4 w-4" /> Changes{onlyChanged ? ` (${changedSet.size})` : ""}
          </Button>
          <MembersPopover boardId={boardId} members={data.members} isOwner={data.role === "owner"} onChange={invalidate} />
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="board" type="LIST" direction="horizontal">
          {(boardProvided) => (
          <div
            ref={boardProvided.innerRef}
            {...boardProvided.droppableProps}
            className="flex h-full items-start gap-3 p-4"
          >
          {data.lists.sort((a, b) => a.position - b.position).map((list, listIndex) => {
            const visible = cardsByList(list.id);
            const mode = sortModeFor(list.id);
            return (
            <Draggable
              key={list.id}
              draggableId={list.id}
              index={listIndex}
              isDragDisabled={!canEdit}
            >
              {(listDragProvided, listDragSnapshot) => (
              <div
                ref={listDragProvided.innerRef}
                {...listDragProvided.draggableProps}
                className={cn(
                  "flex w-72 flex-none flex-col rounded-xl bg-list text-list-foreground shadow-sm max-h-full",
                  listDragSnapshot.isDragging && "ring-2 ring-primary shadow-lg opacity-95",
                )}
              >
                <div
                  {...listDragProvided.dragHandleProps}
                  className="flex items-center justify-between px-3 pt-2 pb-1 cursor-grab active:cursor-grabbing"
                >
                  <InlineRename
                    value={list.title}
                    disabled={!canEdit}
                    onSave={(t) => renameListMut.mutate({ id: list.id, title: t })}
                    className="flex-1 text-sm font-semibold"
                  />
                  <button
                    onClick={() => cycleSort(list.id)}
                    title={mode === "date-asc" ? "Sorted by date (nearest first) — click to disable" : "Sort by date (nearest first)"}
                    className={cn(
                      "rounded p-1 text-list-muted hover:bg-black/5 hover:text-list-foreground",
                      mode === "date-asc" && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
                    )}
                    aria-label="Sort cards by date"
                    aria-pressed={mode === "date-asc"}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                  </button>
                  {canEdit && (
                    <button
                      onClick={async () => { if (await confirmDlg({ title: "Delete this list?", description: "All its cards will be removed.", destructive: true, confirmText: "Delete" })) deleteListMut.mutate(list.id); }}
                      className="rounded p-1 text-list-muted hover:bg-black/5 hover:text-list-foreground"
                      aria-label="Delete list"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Droppable droppableId={list.id} type="CARD" isDropDisabled={!canEdit}>
                  {(dropProvided, dropSnapshot) => (
                    <div
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      className={cn(
                        "flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors",
                        dropSnapshot.isDraggingOver && "bg-black/5",
                      )}
                    >
                      {visible.map((card, i) => (
                        <Draggable
                          key={card.id}
                          draggableId={card.id}
                          index={i}
                          isDragDisabled={!canEdit || mode !== "manual"}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                            >
                              <CardFront
                                card={card}
                                data={data}
                                canEdit={canEdit}
                                onOpen={() => setOpenCard(card.id)}
                                isDragging={dragSnapshot.isDragging}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {dropProvided.placeholder}
                      {canEdit && <NewCardForm onAdd={(title) => createCardMut.mutate({ listId: list.id, title })} />}
                    </div>
                  )}
                </Droppable>
              </div>
              )}
            </Draggable>
            );
          })}

          {boardProvided.placeholder}

          {canEdit && (
            <div className="w-72 flex-none">
              <NewListForm value={newListTitle} setValue={setNewListTitle} onAdd={(t) => { createListMut.mutate(t); setNewListTitle(""); }} />
            </div>
          )}
          </div>
          )}
        </Droppable>
        </DragDropContext>
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

function CardFront({ card, data, canEdit: _canEdit, onOpen, isDragging }: {
  card: any; data: any; canEdit: boolean; onOpen: () => void;
  isDragging?: boolean;
}) {
  const labelIds = new Set(data.cardLabels.filter((cl: any) => cl.card_id === card.id).map((cl: any) => cl.label_id));
  const myLabels = data.labels.filter((l: any) => labelIds.has(l.id));
  const myMembers = card.created_by ? data.members.filter((m: any) => m.user_id === card.created_by) : [];
  const dueDate = card.due_date ? new Date(card.due_date) : null;
  const overdue = dueDate ? dueDate.getTime() < Date.now() : false;
  const dueSoon = dueDate ? (dueDate.getTime() - Date.now()) <= 3 * 24 * 3600 * 1000 : false;

  return (
    <div
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-md bg-tcard text-tcard-foreground p-2 text-sm shadow-sm hover:ring-2 hover:ring-primary/40",
        isDragging && "ring-2 ring-primary shadow-lg",
      )}
    >
      {myLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {myLabels.map((l: any) => (
            <span key={l.id} className="h-2 w-10 rounded-full" style={{ backgroundColor: l.color }} title={l.name} />
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        <div className="flex-1 font-medium">{card.title}</div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-list-muted">
        {dueDate && (
          <span className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
            dueSoon ? "bg-destructive text-destructive-foreground font-semibold" : overdue && "bg-destructive/15 text-destructive",
          )}>
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
              <span key={m.user_id} className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-tcard" style={{ backgroundColor: colorFor(m) }} title={name}>
                {name.slice(0, 1).toUpperCase()}
              </span>
            );
          })}
        </span>
      </div>
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
      className={"rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:outline-none " + (className ?? "")}
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
  const inviteFn = inviteMember;
  const removeFn = removeMember;
  const searchFn = searchProfiles;
  const createInviteFn = createBoardInvite;
  const qc = useQueryClient();
  const confirmDlg = useConfirm();
  const [username, setUsername] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [active, setActive] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const memberIds = new Set(members.map((m) => m.user_id));

  const runSearch = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("@")) { setSuggestions([]); setShowSuggest(false); return; }
    const q = trimmed.slice(1);
    try {
      const rows = await searchFn({ query: q });
      setSuggestions((rows as any[]).filter((r) => !memberIds.has(r.id)).slice(0, 8));
      setActive(0);
      setShowSuggest(true);
    } catch { /* ignore */ }
  };

  const inviteMut = useMutation({
    mutationFn: (name: string) => inviteFn({ boardId, username: name, role: "member" }),
    onSuccess: (res: any) => {
      if (res && res.ok === false) { toast.error(res.error ?? "Failed to add member"); return; }
      toast.success("Member added"); setUsername(""); setSuggestions([]); setShowSuggest(false); onChange();
    },
    onError: (e) => toast.error(e.message),
  });
  const pick = (name: string) => { setUsername(`@${name}`); setShowSuggest(false); inviteMut.mutate(name); };
  const removeMut = useMutation({
    mutationFn: (userId: string) => removeFn({ boardId, userId }),
    onMutate: async (userId: string) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) =>
        d ? { ...d, members: d.members.filter((m: any) => m.user_id !== userId) } : d,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
    onSuccess: () => { toast.success("Member removed"); },
  });
  const handleRemove = async (m: any) => {
    const name = m.profile?.display_name ?? m.profile?.email ?? "this member";
    if (await confirmDlg({ title: `Remove ${name}?`, description: "They will lose access to this board.", destructive: true, confirmText: "Remove" })) {
      removeMut.mutate(m.user_id);
    }
  };
  const copyInviteLink = async () => {
    try {
      const { token } = await createInviteFn({ boardId, role: "member" });
      const url = `${window.location.origin}/invite/${token}`;
      try { await navigator.clipboard.writeText(url); toast.success("Invite link copied to clipboard"); }
      catch { toast.message("Invite link", { description: url }); }
    } catch (e: any) { toast.error(e.message ?? "Failed to create invite"); }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><UserPlus className="h-4 w-4" /> Members ({members.length})</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div className="text-sm font-medium">Board members</div>
          <div className="space-y-1">
            {members.map((m) => {
              const name = m.profile?.display_name ?? m.profile?.email ?? "User";
              return (
              <div key={m.user_id} className="flex items-center justify-between rounded px-2 py-1 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: colorFor(m) }}>
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate">{name}</div>
                    <div className="text-xs text-muted-foreground">{m.role}</div>
                  </div>
                </div>
                {isOwner && m.role !== "owner" && (
                  <button onClick={() => handleRemove(m)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
            })}
          </div>
          {isOwner && (
            <div className="border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="mb-3 w-full" onClick={copyInviteLink}>
                <Link2 className="h-4 w-4" /> Copy invite link
              </Button>
              <form
                onSubmit={(e) => { e.preventDefault(); const name = username.replace(/^@/, "").trim(); if (!name) return; if (showSuggest && suggestions[active]) pick(suggestions[active].display_name ?? name); else inviteMut.mutate(name); }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Input
                    placeholder="@username"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); runSearch(e.target.value); }}
                    onFocus={() => runSearch(username)}
                    onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                    onKeyDown={(e) => {
                      if (!showSuggest || suggestions.length === 0) return;
                      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
                      else if (e.key === "Escape") setShowSuggest(false);
                    }}
                    className="h-8"
                  />
                  {showSuggest && suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pick(s.display_name ?? ""); }}
                          onMouseEnter={() => setActive(i)}
                          className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", i === active && "bg-accent text-accent-foreground")}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{s.display_name ?? "Unnamed"}</div>
                            {s.email && <div className="truncate text-xs text-muted-foreground">{s.email}</div>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button type="submit" size="sm" disabled={inviteMut.isPending}>Add</Button>
              </form>
              <p className="mt-1 text-xs text-muted-foreground">Type @ to browse users.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default BoardPage;
