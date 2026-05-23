import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
  AlignLeft, CheckSquare, Clock, Tag, Trash2, Users, X, Plus, Check, MessageSquare, Paperclip, Download, FileIcon,
} from "lucide-react";
import {
  updateCard, deleteCard,
  createLabel, toggleCardLabel, deleteLabel,
  toggleAssignee,
  addChecklist, addChecklistItem, toggleChecklistItem,
  deleteChecklistItem, deleteChecklist, getCardChecklists,
  getCardComments, addCardComment, updateCardComment, deleteCardComment,
  listCardAttachments, addCardAttachment, deleteCardAttachment, getAttachmentUrl,
} from "@/lib/kanban.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const LABEL_COLORS = [
  "#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0",
  "#0079bf", "#00c2e0", "#51e898", "#ff78cb", "#344563",
];

type Card = { id: string; title: string; description: string | null; due_date: string | null; list_id: string };
type Label = { id: string; name: string; color: string };
type Member = { user_id: string; role: string; profile: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null };

export function CardDialog({
  card, listTitle, boardId, canEdit, labels, cardLabels, assignees, members, onClose,
}: {
  card: Card;
  listTitle: string;
  boardId: string;
  canEdit: boolean;
  labels: Label[];
  cardLabels: { card_id: string; label_id: string }[];
  assignees: { card_id: string; user_id: string }[];
  members: Member[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const invalidateBoard = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  // ---- Card actions ----
  const updateFn = useServerFn(updateCard);
  const deleteFn = useServerFn(deleteCard);
  const update = useMutation({
    mutationFn: (v: any) => updateFn({ data: { id: card.id, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) =>
        d ? { ...d, cards: d.cards.map((c: any) => (c.id === card.id ? { ...c, ...v } : c)) } : d,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: card.id } }),
    onSuccess: () => { invalidateBoard(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  // ---- Title ----
  const [title, setTitle] = useState(card.title);
  useEffect(() => setTitle(card.title), [card.id]);
  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== card.title) update.mutate({ title: t });
    else setTitle(card.title);
  };

  // ---- Description ----
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(card.description ?? "");
  useEffect(() => { setDescDraft(card.description ?? ""); setDescEditing(false); }, [card.id]);
  const saveDesc = () => {
    const v = descDraft.trim();
    if (v !== (card.description ?? "")) update.mutate({ description: v || null });
    setDescEditing(false);
  };

  // ---- Labels ----
  const myLabelIds = new Set(cardLabels.filter((cl) => cl.card_id === card.id).map((cl) => cl.label_id));
  const myLabels = labels.filter((l) => myLabelIds.has(l.id));

  // ---- Members ----
  const myAssignees = new Set(assignees.filter((a) => a.card_id === card.id).map((a) => a.user_id));

  // ---- Due date ----
  const dueDate = card.due_date ? new Date(card.due_date) : null;
  const overdue = dueDate ? dueDate.getTime() < Date.now() : false;

  // ---- Checklists ----
  const getChecklistsFn = useServerFn(getCardChecklists);
  const checklistKey = ["checklists", card.id] as const;
  const { data: cl } = useQuery({
    queryKey: checklistKey,
    queryFn: () => getChecklistsFn({ data: { cardId: card.id } }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-[1fr_220px] gap-6 bg-list text-list-foreground p-5 max-h-[85vh] overflow-y-auto">
          {/* Main column */}
          <div className="space-y-5 min-w-0">
            {/* Title */}
            <div>
              <input
                value={title}
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setTitle(card.title); (e.target as HTMLInputElement).blur(); } }}
                className="w-full bg-transparent text-xl font-semibold outline-none focus:bg-tcard focus:ring-2 focus:ring-primary/40 rounded px-1 -mx-1"
              />
              <div className="text-xs text-list-muted mt-1">in list <span className="underline">{listTitle}</span></div>
            </div>

            {/* Labels + due + members chips */}
            {(myLabels.length > 0 || dueDate || myAssignees.size > 0) && (
              <div className="flex flex-wrap gap-4">
                {myLabels.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-list-muted mb-1">Labels</div>
                    <div className="flex flex-wrap gap-1">
                      {myLabels.map((l) => (
                        <span key={l.id} className="rounded px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: l.color }}>{l.name}</span>
                      ))}
                    </div>
                  </div>
                )}
                {dueDate && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-list-muted mb-1">Due date</div>
                    <div className="flex items-center gap-2 rounded bg-tcard px-2 py-1.5 text-sm">
                      <span>{dueDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {overdue && <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive-foreground">Overdue</span>}
                    </div>
                  </div>
                )}
                {myAssignees.size > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-list-muted mb-1">Members</div>
                    <div className="flex gap-1">
                      {members.filter((m) => myAssignees.has(m.user_id)).map((m) => (
                        <Avatar key={m.user_id} member={m} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <AlignLeft className="h-4 w-4" />
                <h3 className="font-semibold">Description</h3>
                {!descEditing && card.description && canEdit && (
                  <Button size="sm" variant="secondary" className="ml-auto h-7" onClick={() => setDescEditing(true)}>Edit</Button>
                )}
              </div>
              {descEditing ? (
                <div className="space-y-2">
                  <Textarea
                    autoFocus
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setDescDraft(card.description ?? ""); setDescEditing(false); } }}
                    placeholder="Add a more detailed description…"
                    className="min-h-[120px] bg-tcard text-tcard-foreground"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDesc}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDescDraft(card.description ?? ""); setDescEditing(false); }}>Cancel</Button>
                  </div>
                </div>
              ) : card.description ? (
                <div className="whitespace-pre-wrap rounded bg-tcard p-3 text-sm text-tcard-foreground" onClick={() => canEdit && setDescEditing(true)}>{card.description}</div>
              ) : (
                <button
                  disabled={!canEdit}
                  onClick={() => setDescEditing(true)}
                  className="w-full rounded bg-tcard/60 p-3 text-left text-sm text-list-muted hover:bg-tcard"
                >Add a more detailed description…</button>
              )}
            </div>

            {/* Checklists */}
            {cl?.checklists.map((checklist) => (
              <ChecklistBlock
                key={checklist.id}
                boardId={boardId}
                cardId={card.id}
                canEdit={canEdit}
                checklist={checklist}
                items={cl.items.filter((i) => i.checklist_id === checklist.id)}
              />
            ))}

            {/* Comments */}
            <CommentsBlock cardId={card.id} canEdit={canEdit} />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="text-[11px] font-semibold uppercase text-list-muted">Add to card</div>
            <div className="space-y-2">
              <LabelsPopover
                boardId={boardId} cardId={card.id} canEdit={canEdit}
                labels={labels} myLabelIds={myLabelIds}
              />
              <MembersPopover
                boardId={boardId} cardId={card.id} canEdit={canEdit}
                members={members} myAssignees={myAssignees}
              />
              <ChecklistAdd boardId={boardId} cardId={card.id} canEdit={canEdit} />
              <DueDatePopover
                canEdit={canEdit}
                dueDate={dueDate}
                onChange={(d) => update.mutate({ due_date: d })}
              />
            </div>

            {canEdit && (
              <>
                <div className="pt-3 text-[11px] font-semibold uppercase text-list-muted">Actions</div>
                <Button variant="destructive" size="sm" className="w-full justify-start" onClick={() => { if (confirm("Delete this card?")) del.mutate(); }}>
                  <Trash2 className="h-4 w-4" /> Delete card
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Avatar({ member }: { member: Member }) {
  const name = member.profile?.display_name ?? member.profile?.email ?? "?";
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" title={name}>
      {initials}
    </div>
  );
}

function SidebarButton({ icon: Icon, children, ...rest }: any) {
  return (
    <Button variant="secondary" size="sm" className="w-full justify-start gap-2" {...rest}>
      <Icon className="h-4 w-4" /> {children}
    </Button>
  );
}

function LabelsPopover({ boardId, cardId, canEdit, labels, myLabelIds }: { boardId: string; cardId: string; canEdit: boolean; labels: Label[]; myLabelIds: Set<string> }) {
  const qc = useQueryClient();
  const toggleFn = useServerFn(toggleCardLabel);
  const createFn = useServerFn(createLabel);
  const deleteFn = useServerFn(deleteLabel);
  const inv = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  const toggle = useMutation({
    mutationFn: (v: { labelId: string; on: boolean }) => toggleFn({ data: { cardId, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) => {
        if (!d) return d;
        const cardLabels = v.on
          ? [...d.cardLabels, { card_id: cardId, label_id: v.labelId }]
          : d.cardLabels.filter((cl: any) => !(cl.card_id === cardId && cl.label_id === v.labelId));
        return { ...d, cardLabels };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
  });
  const create = useMutation({
    mutationFn: (v: { name: string; color: string }) => createFn({ data: { boardId, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      const tmpId = `tmp-${Math.random()}`;
      qc.setQueryData<any>(["board", boardId], (d: any) =>
        d ? { ...d, labels: [...d.labels, { id: tmpId, name: v.name, color: v.color }] } : d,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
    onSettled: inv,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) =>
        d
          ? {
              ...d,
              labels: d.labels.filter((l: any) => l.id !== id),
              cardLabels: d.cardLabels.filter((cl: any) => cl.label_id !== id),
            }
          : d,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
    onSettled: inv,
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  return (
    <Popover>
      <PopoverTrigger asChild><SidebarButton icon={Tag} disabled={!canEdit}>Labels</SidebarButton></PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="text-sm font-medium mb-2">Labels</div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              <button
                onClick={() => toggle.mutate({ labelId: l.id, on: !myLabelIds.has(l.id) })}
                className="flex flex-1 items-center justify-between rounded px-3 py-1.5 text-sm font-semibold text-white"
                style={{ backgroundColor: l.color }}
              >
                <span>{l.name}</span>
                {myLabelIds.has(l.id) && <Check className="h-4 w-4" />}
              </button>
              <button onClick={() => { if (confirm("Delete label?")) remove.mutate(l.id); }} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {labels.length === 0 && <div className="text-xs text-muted-foreground">No labels yet.</div>}
        </div>
        <div className="mt-3 border-t pt-3">
          {creating ? (
            <form
              onSubmit={(e) => { e.preventDefault(); if (name.trim()) { create.mutate({ name: name.trim(), color }); setName(""); setCreating(false); } }}
              className="space-y-2"
            >
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" className="h-8" />
              <div className="flex flex-wrap gap-1">
                {LABEL_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} className={cn("h-6 w-6 rounded", color === c && "ring-2 ring-ring ring-offset-1")} style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Create</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create new label
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MembersPopover({ boardId, cardId, canEdit, members, myAssignees }: { boardId: string; cardId: string; canEdit: boolean; members: Member[]; myAssignees: Set<string> }) {
  const qc = useQueryClient();
  const toggleFn = useServerFn(toggleAssignee);
  const toggle = useMutation({
    mutationFn: (v: { userId: string; on: boolean }) => toggleFn({ data: { cardId, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) => {
        if (!d) return d;
        const assignees = v.on
          ? [...d.assignees, { card_id: cardId, user_id: v.userId }]
          : d.assignees.filter((a: any) => !(a.card_id === cardId && a.user_id === v.userId));
        return { ...d, assignees };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
  });
  return (
    <Popover>
      <PopoverTrigger asChild><SidebarButton icon={Users} disabled={!canEdit}>Members</SidebarButton></PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="text-sm font-medium mb-2">Board members</div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {members.map((m) => {
            const name = m.profile?.display_name ?? m.profile?.email ?? "User";
            const on = myAssignees.has(m.user_id);
            return (
              <button
                key={m.user_id}
                onClick={() => toggle.mutate({ userId: m.user_id, on: !on })}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Avatar member={m} />
                <span className="flex-1 text-left">{name}</span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DueDatePopover({ canEdit, dueDate, onChange }: { canEdit: boolean; dueDate: Date | null; onChange: (v: string | null) => void }) {
  const [time, setTime] = useState(dueDate ? format(dueDate, "HH:mm") : "12:00");
  useEffect(() => { if (dueDate) setTime(format(dueDate, "HH:mm")); }, [dueDate?.getTime()]);
  const apply = (date: Date | undefined, t: string) => {
    if (!date) { onChange(null); return; }
    const [h, m] = t.split(":").map(Number);
    const d = new Date(date);
    d.setHours(h || 0, m || 0, 0, 0);
    onChange(d.toISOString());
  };
  return (
    <Popover>
      <PopoverTrigger asChild><SidebarButton icon={Clock} disabled={!canEdit}>Dates</SidebarButton></PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end">
        <div className="text-sm font-medium mb-2">Due date</div>
        <Calendar
          mode="single"
          selected={dueDate ?? undefined}
          onSelect={(d) => apply(d, time)}
          initialFocus
          className={cn("p-0 pointer-events-auto")}
        />
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Time</span>
          <Input
            type="time"
            value={time}
            onChange={(e) => { setTime(e.target.value); if (dueDate) apply(dueDate, e.target.value); }}
            className="h-8 w-32"
          />
        </div>
        {dueDate && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => onChange(null)}>
            <X className="h-4 w-4" /> Remove date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ChecklistAdd({ boardId, cardId, canEdit }: { boardId: string; cardId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const fn = useServerFn(addChecklist);
  const key = ["checklists", cardId] as const;
  const mut = useMutation({
    mutationFn: (title: string) => fn({ data: { cardId, title } }),
    onMutate: async (title) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      const tmpId = `tmp-${Math.random()}`;
      qc.setQueryData<any>(key, (d: any) => {
        const base = d ?? { checklists: [], items: [] };
        return { ...base, checklists: [...base.checklists, { id: tmpId, title, position: 9999 }] };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Checklist");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><SidebarButton icon={CheckSquare} disabled={!canEdit}>Checklist</SidebarButton></PopoverTrigger>
      <PopoverContent className="w-72">
        <form
          onSubmit={(e) => { e.preventDefault(); if (title.trim()) { mut.mutate(title.trim()); setTitle("Checklist"); setOpen(false); } }}
          className="space-y-2"
        >
          <div className="text-sm font-medium">Add checklist</div>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ChecklistBlock({ boardId, cardId, canEdit, checklist, items }: {
  boardId: string; cardId: string; canEdit: boolean;
  checklist: { id: string; title: string };
  items: { id: string; text: string; done: boolean }[];
}) {
  const qc = useQueryClient();
  const key = ["checklists", cardId] as const;
  const inv = () => qc.invalidateQueries({ queryKey: key });

  const addItemFn = useServerFn(addChecklistItem);
  const toggleFn = useServerFn(toggleChecklistItem);
  const deleteItemFn = useServerFn(deleteChecklistItem);
  const deleteListFn = useServerFn(deleteChecklist);

  const patchItems = (fn: (items: any[]) => any[]) =>
    qc.setQueryData<any>(key, (d: any) => (d ? { ...d, items: fn(d.items) } : d));

  const addItem = useMutation({
    mutationFn: (text: string) => addItemFn({ data: { checklistId: checklist.id, text } }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      const tmpId = `tmp-${Math.random()}`;
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return { ...d, items: [...d.items, { id: tmpId, checklist_id: checklist.id, text, done: false, position: 9999 }] };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: inv,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => toggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      patchItems((items) => items.map((i) => (i.id === v.id ? { ...i, done: v.done } : i)));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const delItem = useMutation({
    mutationFn: (id: string) => deleteItemFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      patchItems((items) => items.filter((i) => i.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const delList = useMutation({
    mutationFn: () => deleteListFn({ data: { id: checklist.id } }),
    onSuccess: inv, onError: (e) => toast.error(e.message),
  });

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <CheckSquare className="h-4 w-4" />
        <h3 className="font-semibold">{checklist.title}</h3>
        {canEdit && (
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => { if (confirm("Delete checklist?")) delList.mutate(); }}>Delete</Button>
        )}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <span className="w-8 text-xs text-list-muted">{pct}%</span>
        <Progress value={pct} className="h-1.5 flex-1" />
      </div>
      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-black/5">
            <Checkbox checked={i.done} onCheckedChange={(v) => toggle.mutate({ id: i.id, done: !!v })} disabled={!canEdit} />
            <span className={cn("flex-1 text-sm", i.done && "text-list-muted line-through")}>{i.text}</span>
            {canEdit && (
              <button onClick={() => delItem.mutate(i.id)} className="opacity-0 group-hover:opacity-100 text-list-muted hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-2 pl-7">
          {adding ? (
            <form
              onSubmit={(e) => { e.preventDefault(); if (text.trim()) { addItem.mutate(text.trim()); setText(""); } }}
              className="space-y-2"
            >
              <Textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) { addItem.mutate(text.trim()); setText(""); } } if (e.key === "Escape") { setAdding(false); setText(""); } }}
                placeholder="Add an item"
                className="min-h-[60px] bg-tcard text-tcard-foreground"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm">Add</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setText(""); }}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add an item</Button>
          )}
        </div>
      )}
    </div>
  );
}

function CommentsBlock({ cardId, canEdit }: { cardId: string; canEdit: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["comments", cardId] as const;
  const getFn = useServerFn(getCardComments);
  const addFn = useServerFn(addCardComment);
  const updFn = useServerFn(updateCardComment);
  const delFn = useServerFn(deleteCardComment);

  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { cardId } }),
  });

  const add = useMutation({
    mutationFn: (body: string) => addFn({ data: { cardId, body } }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key);
      const tmp = {
        id: `tmp-${Math.random()}`,
        card_id: cardId,
        user_id: user?.id ?? "",
        body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        profile: {
          id: user?.id ?? "",
          display_name: user?.user_metadata?.display_name ?? user?.email?.split("@")[0] ?? "You",
          email: user?.email ?? null,
          avatar_url: user?.user_metadata?.avatar_url ?? null,
        },
      };
      qc.setQueryData<any[]>(key, (d) => [tmp, ...(d ?? [])]);
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; body: string }) => updFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key);
      qc.setQueryData<any[]>(key, (d) =>
        (d ?? []).map((c) => (c.id === v.id ? { ...c, body: v.body, updated_at: new Date().toISOString() } : c)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key);
      qc.setQueryData<any[]>(key, (d) => (d ?? []).filter((c) => c.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const [body, setBody] = useState("");

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        <h3 className="font-semibold">Comments</h3>
      </div>
      {canEdit && (
        <form
          onSubmit={(e) => { e.preventDefault(); const v = body.trim(); if (v) { add.mutate(v); setBody(""); } }}
          className="mb-4 space-y-2"
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const v = body.trim();
                if (v) { add.mutate(v); setBody(""); }
              }
            }}
            placeholder="Write a comment…"
            className="min-h-[70px] bg-tcard text-tcard-foreground"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!body.trim()}>Save</Button>
            <span className="text-xs text-list-muted">Ctrl/⌘ + Enter to save</span>
          </div>
        </form>
      )}
      <div className="space-y-3">
        {comments.map((c: any) => (
          <CommentRow
            key={c.id}
            comment={c}
            isOwn={c.user_id === user?.id}
            onUpdate={(body) => update.mutate({ id: c.id, body })}
            onDelete={() => remove.mutate(c.id)}
          />
        ))}
        {comments.length === 0 && <div className="text-xs text-list-muted">No comments yet.</div>}
      </div>
    </div>
  );
}

function CommentRow({ comment, isOwn, onUpdate, onDelete }: {
  comment: any; isOwn: boolean; onUpdate: (body: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const name = comment.profile?.display_name ?? comment.profile?.email ?? "User";
  const initials = name.slice(0, 2).toUpperCase();
  const when = new Date(comment.created_at);
  const edited = comment.updated_at && comment.updated_at !== comment.created_at;
  return (
    <div className="flex gap-2">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-semibold text-list-foreground">{name}</span>
          <span className="text-list-muted">
            {when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {edited && " (edited)"}
          </span>
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60px] bg-tcard text-tcard-foreground"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { const v = draft.trim(); if (v) { onUpdate(v); setEditing(false); } }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(comment.body); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap rounded bg-tcard p-2 text-sm text-tcard-foreground">{comment.body}</div>
        )}
        {isOwn && !editing && (
          <div className="mt-1 flex gap-3 text-xs text-list-muted">
            <button className="hover:underline" onClick={() => setEditing(true)}>Edit</button>
            <button className="hover:underline" onClick={() => { if (confirm("Delete comment?")) onDelete(); }}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}