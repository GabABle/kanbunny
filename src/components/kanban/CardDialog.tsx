import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  AlignLeft, CheckSquare, Clock, Tag, Trash2, Users, X, Plus, Check, MessageSquare, Paperclip, Download, FileIcon, Loader2, User as UserIcon, Archive, Sparkles, Brain,
} from "lucide-react";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import {
  updateCard, deleteCard,
  archiveCard,
  createLabel, toggleCardLabel, deleteLabel,
  toggleAssignee,
  addChecklist, addChecklistItem, toggleChecklistItem,
  deleteChecklistItem, deleteChecklist, renameChecklist,
  getCardComments, addCardComment, updateCardComment, deleteCardComment,
  listCardAttachments, addCardAttachment, deleteCardAttachment, getAttachmentUrl,
  getCardActivities, getCardDetails, updateCardOwner,
} from "@/lib/kanban.functions";
import { runPMAgent, getCardAIMeta, startCard, haltAgent, getCardAgentRuns, type CardAIMeta, type AgentRun } from "@/lib/agent.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { colorFor } from "@/lib/avatar-color";

const LABEL_COLORS = [
  "#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0",
  "#0079bf", "#00c2e0", "#51e898", "#ff78cb", "#344563",
];

type Card = { id: string; title: string; description: string | null; due_date: string | null; list_id: string; created_by?: string | null };
type Label = { id: string; name: string; color: string };
type Member = { user_id: string; role: string; profile: { id: string; display_name: string | null; email: string | null; avatar_url: string | null; avatar_color?: string | null } | null };

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
  const confirm = useConfirm();

  // ---- Card actions ----
  const updateFn = updateCard;
  const deleteFn = deleteCard;
  const archiveFn = archiveCard;
  const update = useMutation({
    mutationFn: (v: any) => updateFn({ id: card.id, ...v }),
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
    mutationFn: () => deleteFn({ id: card.id }),
    onSuccess: () => { invalidateBoard(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: () => archiveFn({ id: card.id, archived: true }),
    onSuccess: () => { invalidateBoard(); onClose(); toast.success("Card archived"); },
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
  const [descDraft, setDescDraft] = useState(card.description ?? "");
  useEffect(() => { setDescDraft(card.description ?? ""); }, [card.id]);
  const saveDesc = () => {
    const v = descDraft.trim();
    if (v !== (card.description ?? "")) update.mutate({ description: v || null });
  };

  // ---- Labels ----
  const myLabelIds = new Set(cardLabels.filter((cl) => cl.card_id === card.id).map((cl) => cl.label_id));
  const myLabels = labels.filter((l) => myLabelIds.has(l.id));

  // ---- Members ----
  const myAssignees = new Set(assignees.filter((a) => a.card_id === card.id).map((a) => a.user_id));

  // ---- Due date ----
  const dueDate = card.due_date ? new Date(card.due_date) : null;
  const overdue = dueDate ? dueDate.getTime() < Date.now() : false;
  const owner = card.created_by ? members.find((m) => m.user_id === card.created_by) : null;
  const ownerName = owner?.profile?.display_name ?? owner?.profile?.email ?? null;

  // ---- Checklists ----
  const isRealCard = !card.id.startsWith("tmp-");
  const getDetailsFn = getCardDetails;
  // Single source of truth: the ["checklists", card.id] cache. Mutations in
  // ChecklistAdd / ChecklistBlock write to this same key so create/delete
  // actions reflect immediately.
  const { data: cl, isLoading: detailsLoading } = useQuery({
    queryKey: ["checklists", card.id],
    queryFn: async () => {
      const d = await getDetailsFn({ cardId: card.id });
      qc.setQueryData(["comments", card.id], d.comments);
      qc.setQueryData(["attachments", card.id], d.attachments);
      qc.setQueryData(["activities", card.id], (d as any).activities ?? []);
      return { checklists: d.checklists, items: d.items };
    },
    enabled: isRealCard,
    staleTime: 30_000,
  });

  // ---- SWE Agent ----
  const { data: agentRuns = [], refetch: refetchRuns } = useQuery({
    queryKey: ["agent_runs", card.id],
    queryFn: () => getCardAgentRuns({ cardId: card.id }),
    enabled: isRealCard,
    refetchInterval: (data) => {
      const runs = data?.state?.data;
      return Array.isArray(runs) && runs.some((r: AgentRun) => r.status === "running") ? 3000 : false;
    },
  });
  const activeRun = agentRuns.find((r) => r.status === "running" || r.status === "paused");
  const sweStart = useMutation({
    mutationFn: () => startCard({ board_id: boardId, card_id: card.id }),
    onSuccess: () => {
      refetchRuns();
      qc.invalidateQueries({ queryKey: ["board", boardId] });
      qc.invalidateQueries({ queryKey: ["checklists", card.id] });
      toast.success("SWE Agent started on this card");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sweHalt = useMutation({
    mutationFn: () => haltAgent({ board_id: boardId, card_id: card.id, run_id: activeRun!.id }),
    onSuccess: () => {
      refetchRuns();
      qc.invalidateQueries({ queryKey: ["board", boardId] });
      toast.info("SWE Agent halted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ---- PM Agent ----
  const { data: aiMeta, refetch: refetchAIMeta } = useQuery({
    queryKey: ["card_ai_meta", card.id],
    queryFn: () => getCardAIMeta({ cardId: card.id }),
    enabled: isRealCard,
    staleTime: 60_000,
  });
  const [pmOpen, setPmOpen] = useState(false);
  const [manualPriority, setManualPriority] = useState<number>(3);
  const [manualUrgency, setManualUrgency] = useState<number>(3);
  const pmEval = useMutation({
    mutationFn: (override?: { priority: number; urgency: number }) =>
      runPMAgent({
        card_id: card.id,
        user_priority: override?.priority ?? null,
        user_urgency: override?.urgency ?? null,
      }),
    onSuccess: () => {
      refetchAIMeta();
      qc.invalidateQueries({ queryKey: ["checklists", card.id] }); // refresh comments
      toast.success("PM Agent evaluated the card");
      setPmOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-3xl gap-0 overflow-hidden p-0 font-montserrat"
        onOpenAutoFocus={(e) => {
          // Don't move focus into the dialog when it opens
          e.preventDefault();
          if (typeof document !== "undefined") {
            (document.activeElement as HTMLElement | null)?.blur?.();
          }
        }}
      >
        <div className="grid grid-cols-[1fr_220px] gap-6 bg-list text-list-foreground p-5 max-h-[85vh] overflow-y-auto outline-none">
          {/* Main column */}
          <div className="space-y-5 min-w-0">
            {/* Title */}
            <div>
              <MentionField
                multiline={false}
                value={title}
                onChange={setTitle}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === "Escape") { setTitle(card.title); (e.target as HTMLInputElement).blur(); }
                }}
                disabled={!canEdit}
                members={members}
                className="w-full bg-transparent text-xl font-semibold outline-none border border-transparent focus:border-transparent focus:outline-none rounded px-1 -mx-1 h-auto shadow-none"
              />
              <div className="text-xs text-list-muted mt-1">in list <span className="underline">{listTitle}</span></div>
            </div>

          {/* Labels + due + owner chips */}
            {(myLabels.length > 0 || dueDate || ownerName) && (() => {
              const dueSoon = dueDate ? (dueDate.getTime() - Date.now()) <= 3 * 24 * 3600 * 1000 : false;
              return (
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
                    <div className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
                      dueSoon ? "bg-destructive text-destructive-foreground" : "bg-tcard"
                    )}>
                      <span>{dueDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {overdue && <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Overdue</span>}
                    </div>
                  </div>
                )}
                {ownerName && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-list-muted mb-1">Owner</div>
                    <div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                      <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: colorFor(owner) }}>
                        {ownerName.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{ownerName}</span>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}

            {/* PM Agent evaluation badge */}
            {aiMeta && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30 px-3 py-2">
                <Brain className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-3 mb-1">
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-violet-500 mr-1">Priority</span>
                      <PriorityDots value={aiMeta.priority_score} color="violet" />
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-violet-500 mr-1">Urgency</span>
                      <PriorityDots value={aiMeta.urgency_score} color="orange" />
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded",
                      aiMeta.evaluated_by === "user" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                    )}>
                      {aiMeta.evaluated_by === "user" ? "Manual" : "AI"}
                    </span>
                  </div>
                  {aiMeta.rationale && (
                    <p className="text-xs text-muted-foreground italic">{aiMeta.rationale}</p>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <AlignLeft className="h-4 w-4" />
                <h3 className="font-semibold">Description</h3>
              </div>
              <MentionField
                value={descDraft}
                onChange={setDescDraft}
                onBlur={saveDesc}
                onKeyDown={(e) => { if (e.key === "Escape") { setDescDraft(card.description ?? ""); (e.target as HTMLTextAreaElement).blur(); } }}
                disabled={!canEdit}
                members={members}
                placeholder="Add a more detailed description… use @ to mention"
                className="min-h-[100px] bg-tcard text-tcard-foreground"
              />
            </div>

            {/* Checklists */}
            {isRealCard && detailsLoading && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-tcard/60 py-10 text-list-muted">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="text-xs">Loading checklists, comments and activity…</div>
              </div>
            )}
            {!detailsLoading && cl?.checklists.map((checklist) => (
              <ChecklistBlock
                key={checklist.id}
                boardId={boardId}
                cardId={card.id}
                canEdit={canEdit}
                checklist={checklist}
                items={cl.items.filter((i) => i.checklist_id === checklist.id)}
                members={members}
              />
            ))}

            {/* Comments */}
            {!detailsLoading && (
              <>
                <AttachmentsBlock cardId={card.id} canEdit={canEdit} />
                <CommentsBlock cardId={card.id} canEdit={canEdit} members={members} />
                <ActivityBlock cardId={card.id} />
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="text-[11px] font-semibold uppercase text-list-muted">Add to card</div>
            <div className="space-y-2">
              <OwnerPopover
                boardId={boardId} cardId={card.id} canEdit={canEdit}
                members={members} ownerId={card.created_by ?? null}
              />
              <LabelsPopover
                boardId={boardId} cardId={card.id} canEdit={canEdit}
                labels={labels} myLabelIds={myLabelIds}
              />
              <ChecklistAdd boardId={boardId} cardId={card.id} canEdit={canEdit} members={members} />
              <DueDatePopover
                canEdit={canEdit}
                dueDate={dueDate}
                onChange={(d) => update.mutate({ due_date: d })}
              />
              <AttachmentButton cardId={card.id} canEdit={canEdit} />
            </div>

            {/* PM Agent section */}
            <div className="pt-3 text-[11px] font-semibold uppercase text-list-muted">Agents</div>
            <div className="space-y-2">
              <Popover open={pmOpen} onOpenChange={setPmOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary" size="sm"
                    className="w-full justify-start gap-2"
                    disabled={!isRealCard}
                  >
                    <Brain className="h-4 w-4 text-violet-500" />
                    {aiMeta ? "Re-evaluate (PM)" : "Evaluate (PM Agent)"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="end">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4 text-violet-500" /> PM Agent
                    </div>
                    <Button
                      size="sm" className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                      disabled={pmEval.isPending}
                      onClick={() => pmEval.mutate(undefined)}
                    >
                      {pmEval.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Auto-evaluate with AI
                    </Button>
                    <div className="border-t pt-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">Or set manually</div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs">Priority</span>
                          <ScorePicker value={manualPriority} onChange={setManualPriority} color="violet" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs">Urgency</span>
                          <ScorePicker value={manualUrgency} onChange={setManualUrgency} color="orange" />
                        </div>
                        <Button
                          size="sm" variant="outline" className="w-full"
                          disabled={pmEval.isPending}
                          onClick={() => pmEval.mutate({ priority: manualPriority, urgency: manualUrgency })}
                        >
                          Save manual scores
                        </Button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* SWE Agent button */}
            {canEdit && isRealCard && (
              activeRun ? (
                <Button
                  variant="secondary" size="sm"
                  className="w-full justify-start gap-2 border border-blue-400/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                  onClick={() => sweHalt.mutate()}
                  disabled={sweHalt.isPending}
                >
                  {sweHalt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-base leading-none">⏹</span>}
                  {activeRun.status === "running" ? "Stop SWE Agent" : "Agent paused — Stop"}
                </Button>
              ) : (
                <Button
                  variant="secondary" size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => sweStart.mutate()}
                  disabled={sweStart.isPending || (card as any).agent_status === "done"}
                >
                  {sweStart.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-base leading-none">⚙️</span>}
                  {(card as any).agent_status === "done" ? "SWE Done ✓" : "Run SWE Agent"}
                </Button>
              )
            )}

            {canEdit && (
              <>
                <div className="pt-3 text-[11px] font-semibold uppercase text-list-muted">Actions</div>
                <Button variant="secondary" size="sm" className="w-full justify-start gap-2" onClick={async () => { if (await confirm({ title: "Archive card?", description: "It will be hidden from the board.", confirmText: "Archive" })) archive.mutate(); }}>
                  <Archive className="h-4 w-4" /> Archive card
                </Button>
                <Button variant="destructive" size="sm" className="w-full justify-start" onClick={async () => { if (await confirm({ title: "Delete card?", confirmText: "Delete", destructive: true })) del.mutate(); }}>
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
    <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: colorFor(member) }} title={name}>
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
  const toggleFn = toggleCardLabel;
  const createFn = createLabel;
  const deleteFn = deleteLabel;
  const confirmDlg = useConfirm();
  const inv = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  const toggle = useMutation({
    mutationFn: (v: { labelId: string; on: boolean }) => toggleFn({ cardId, ...v }),
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
    mutationFn: (v: { name: string; color: string }) => createFn({ boardId, ...v }),
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
    mutationFn: (id: string) => deleteFn({ id }),
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
                onClick={() => {
                  if (l.id.startsWith("tmp-")) { toast.message("Saving label…"); return; }
                  toggle.mutate({ labelId: l.id, on: !myLabelIds.has(l.id) });
                }}
                className="flex flex-1 items-center justify-between rounded px-3 py-1.5 text-sm font-semibold text-white"
                style={{ backgroundColor: l.color }}
              >
                <span>{l.name}</span>
                {myLabelIds.has(l.id) && <Check className="h-4 w-4" />}
              </button>
              <button onClick={async () => { if (l.id.startsWith("tmp-")) return; const c = await confirmDlg({ title: "Delete label?", destructive: true, confirmText: "Delete" }); if (c) remove.mutate(l.id); }} className="text-muted-foreground hover:text-destructive">
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
  const toggleFn = toggleAssignee;
  const toggle = useMutation({
    mutationFn: (v: { userId: string; on: boolean }) => toggleFn({ cardId, ...v }),
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
      <PopoverTrigger asChild><SidebarButton icon={Clock} disabled={!canEdit}>Due Date</SidebarButton></PopoverTrigger>
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

function ChecklistAdd({ boardId, cardId, canEdit, members }: { boardId: string; cardId: string; canEdit: boolean; members: Member[] }) {
  const qc = useQueryClient();
  const fn = addChecklist;
  const key = ["checklists", cardId] as const;
  const mut = useMutation({
    mutationFn: (title: string) => fn({ cardId, title }),
    onMutate: async (title) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      const tmpId = `tmp-${Math.random()}`;
      qc.setQueryData<any>(key, (d: any) => {
        const base = d ?? { checklists: [], items: [] };
        return { ...base, checklists: [...base.checklists, { id: tmpId, title, position: 9999 }] };
      });
      return { prev, tmpId };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSuccess: (real: any, _v, ctx) => {
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return { ...d, checklists: d.checklists.map((c: any) => (c.id === ctx?.tmpId ? real : c)) };
      });
    },
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
          <MentionField multiline={false} autoFocus value={title} onChange={setTitle} members={members} />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ChecklistBlock({ boardId, cardId, canEdit, checklist, items, members }: {
  boardId: string; cardId: string; canEdit: boolean;
  checklist: { id: string; title: string };
  items: { id: string; text: string; done: boolean }[];
  members: Member[];
}) {
  const qc = useQueryClient();
  const key = ["checklists", cardId] as const;
  const inv = () => qc.invalidateQueries({ queryKey: key });
  const confirmDlg = useConfirm();

  const addItemFn = addChecklistItem;
  const toggleFn = toggleChecklistItem;
  const deleteItemFn = deleteChecklistItem;
  const deleteListFn = deleteChecklist;
  const renameListFn = renameChecklist;

  const patchItems = (fn: (items: any[]) => any[]) =>
    qc.setQueryData<any>(key, (d: any) => (d ? { ...d, items: fn(d.items) } : d));

  const addItem = useMutation({
    mutationFn: (text: string) => addItemFn({ checklistId: checklist.id, text }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      const tmpId = `tmp-${Math.random()}`;
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return { ...d, items: [...d.items, { id: tmpId, checklist_id: checklist.id, text, done: false, position: 9999 }] };
      });
      return { prev, tmpId };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSuccess: (real: any, _v, ctx) => {
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return { ...d, items: d.items.map((i: any) => (i.id === ctx?.tmpId ? { ...i, ...real } : i)) };
      });
    },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => toggleFn(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      patchItems((items) => items.map((i) => (i.id === v.id ? { ...i, done: v.done } : i)));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const delItem = useMutation({
    mutationFn: (id: string) => deleteItemFn({ id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      patchItems((items) => items.filter((i) => i.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const delList = useMutation({
    mutationFn: () => deleteListFn({ id: checklist.id }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return {
          ...d,
          checklists: d.checklists.filter((c: any) => c.id !== checklist.id),
          items: d.items.filter((i: any) => i.checklist_id !== checklist.id),
        };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });
  const renameList = useMutation({
    mutationFn: (title: string) => renameListFn({ id: checklist.id, title }),
    onMutate: async (title) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      qc.setQueryData<any>(key, (d: any) => {
        if (!d) return d;
        return { ...d, checklists: d.checklists.map((c: any) => (c.id === checklist.id ? { ...c, title } : c)) };
      });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
  });

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(checklist.title);
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <CheckSquare className="h-4 w-4" />
        {editingTitle && canEdit ? (
          <MentionField
            multiline={false}
            autoFocus
            value={titleDraft}
            onChange={setTitleDraft}
            members={members}
            onBlur={() => {
              const t = titleDraft.trim();
              if (t && t !== checklist.title) renameList.mutate(t);
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setTitleDraft(checklist.title); setEditingTitle(false); }
            }}
            className="h-7 max-w-xs"
          />
        ) : (
          <h3
            className={cn("font-semibold", canEdit && "cursor-pointer rounded px-1 hover:bg-black/5")}
            onClick={() => { if (canEdit) { setTitleDraft(checklist.title); setEditingTitle(true); } }}
            title={canEdit ? "Click to rename" : undefined}
          >
            {checklist.title}
          </h3>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={async () => { if (await confirmDlg({ title: "Delete checklist?", destructive: true, confirmText: "Delete" })) delList.mutate(); }}>Delete</Button>
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
              <button
                onClick={async () => { if (await confirmDlg({ title: "Delete this item?", destructive: true, confirmText: "Delete" })) delItem.mutate(i.id); }}
                title="Delete item"
                className="text-list-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
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
              <MentionField
                autoFocus
                value={text}
                onChange={setText}
                members={members}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) { addItem.mutate(text.trim()); setText(""); }
                  }
                  if (e.key === "Escape") { setAdding(false); setText(""); }
                }}
                placeholder="Add an item — use @ to mention"
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

function AttachmentButton({ cardId, canEdit }: { cardId: string; canEdit: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const addFn = addCardAttachment;
  const key = ["attachments", cardId] as const;
  const [uploading, setUploading] = useState(false);

  const onPick = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${cardId}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("card-attachments").upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (error) throw error;
      await addFn({ cardId, file_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size });
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
      <SidebarButton icon={Paperclip} disabled={!canEdit || uploading} onClick={() => ref.current?.click()}>
        {uploading ? "Uploading…" : "Attachment"}
      </SidebarButton>
    </>
  );
}

function AttachmentsBlock({ cardId, canEdit }: { cardId: string; canEdit: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirmDlg = useConfirm();
  const key = ["attachments", cardId] as const;
  const listFn = listCardAttachments;
  const delFn = deleteCardAttachment;
  const urlFn = getAttachmentUrl;
  const { data: attachments = [] } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ cardId }),
    enabled: /^[0-9a-f-]{36}$/i.test(cardId),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key);
      qc.setQueryData<any[]>(key, (d) => (d ?? []).filter((a) => a.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(e.message); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const open = async (path: string) => {
    try {
      const { url } = await urlFn({ file_path: path });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) { toast.error(e.message); }
  };
  if (attachments.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Paperclip className="h-4 w-4" />
        <h3 className="font-semibold">Attachments</h3>
      </div>
      <div className="space-y-2">
        {attachments.map((a: any) => (
          <div key={a.id} className="flex items-center gap-3 rounded bg-tcard p-2 text-sm">
            <div className="grid h-10 w-14 shrink-0 place-items-center rounded bg-list text-list-muted">
              <FileIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <button onClick={() => open(a.file_path)} className="block w-full truncate text-left font-medium hover:underline">{a.file_name}</button>
              <div className="text-xs text-list-muted">
                {new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {a.size_bytes ? ` · ${formatBytes(a.size_bytes)}` : ""}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => open(a.file_path)} title="Download"><Download className="h-4 w-4" /></Button>
            {(canEdit || a.user_id === user?.id) && (
              <Button size="sm" variant="ghost" onClick={async () => { if (await confirmDlg({ title: "Delete attachment?", destructive: true, confirmText: "Delete" })) remove.mutate(a.id); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function CommentsBlock({ cardId, canEdit, members }: { cardId: string; canEdit: boolean; members: Member[] }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["comments", cardId] as const;
  const getFn = getCardComments;
  const addFn = addCardComment;
  const updFn = updateCardComment;
  const delFn = deleteCardComment;

  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: () => getFn({ cardId }),
    refetchOnWindowFocus: false,
    enabled: /^[0-9a-f-]{36}$/i.test(cardId),
  });

  const add = useMutation({
    mutationFn: (v: { body: string; parent_id?: string | null }) => addFn({ cardId, body: v.body, parent_id: v.parent_id ?? null }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key);
      const tmp = {
        id: `tmp-${Math.random()}`,
        card_id: cardId,
        user_id: user?.id ?? "",
        body: v.body,
        parent_id: v.parent_id ?? null,
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
    mutationFn: (v: { id: string; body: string }) => updFn(v),
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
    mutationFn: (id: string) => delFn({ id }),
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
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [open, setOpen] = useState(true);

  // Group replies by parent
  const topLevel = (comments as any[]).filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, any[]>();
  for (const c of comments as any[]) {
    if (c.parent_id) {
      const arr = repliesByParent.get(c.parent_id) ?? [];
      arr.push(c);
      repliesByParent.set(c.parent_id, arr);
    }
  }
  // Sort replies oldest first within thread
  for (const arr of repliesByParent.values()) arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 flex w-full items-center gap-2 text-left font-semibold"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <MessageSquare className="h-4 w-4" />
        <span>Comments</span>
        <span className="ml-1 text-xs font-normal text-list-muted">
          ({comments.length}) {open ? "(hide)" : "(show)"}
        </span>
      </button>
      {open && canEdit && (
        <form
          onSubmit={(e) => { e.preventDefault(); const v = body.trim(); if (v) { add.mutate({ body: v }); setBody(""); } }}
          className="mb-4 space-y-2"
        >
          <MentionField
            value={body}
            onChange={setBody}
            members={members}
            placeholder="Write a comment… use @ to mention"
            onSubmit={() => { const v = body.trim(); if (v) { add.mutate({ body: v }); setBody(""); } }}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!body.trim()}>Save</Button>
            <span className="text-xs text-list-muted">Ctrl/⌘ + Enter to save</span>
          </div>
        </form>
      )}
      {open && (
      <div className="space-y-3">
        {topLevel.map((c: any) => (
          <div key={c.id} className="space-y-2">
            <CommentRow
              comment={c}
              isOwn={c.user_id === user?.id}
              canReply={canEdit}
              members={members}
              onUpdate={(body) => update.mutate({ id: c.id, body })}
              onDelete={() => remove.mutate(c.id)}
              replying={replyTo === c.id}
              replyBody={replyBody}
              onReplyBodyChange={setReplyBody}
              onToggleReply={() => {
                setReplyTo((cur) => (cur === c.id ? null : c.id));
                setReplyBody("");
              }}
              onSubmitReply={() => {
                const v = replyBody.trim();
                if (!v) return;
                add.mutate({ body: v, parent_id: c.id });
                setReplyBody("");
                setReplyTo(null);
              }}
            />
            {(repliesByParent.get(c.id) ?? []).length > 0 && (
              <div className="ml-10 space-y-2 border-l-2 border-border/40 pl-3">
                {(repliesByParent.get(c.id) ?? []).map((r: any) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    isOwn={r.user_id === user?.id}
                    canReply={false}
                    members={members}
                    onUpdate={(body) => update.mutate({ id: r.id, body })}
                    onDelete={() => remove.mutate(r.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && <div className="text-xs text-list-muted">No comments yet.</div>}
      </div>
      )}
    </div>
  );
}

function CommentRow({
  comment, isOwn, canReply, members, onUpdate, onDelete,
  replying, replyBody, onReplyBodyChange, onToggleReply, onSubmitReply,
}: {
  comment: any; isOwn: boolean; canReply?: boolean;
  members: Member[];
  onUpdate: (body: string) => void; onDelete: () => void;
  replying?: boolean;
  replyBody?: string;
  onReplyBodyChange?: (v: string) => void;
  onToggleReply?: () => void;
  onSubmitReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const confirmDlg = useConfirm();
  const name = comment.profile?.display_name ?? comment.profile?.email ?? "User";
  const initials = name.slice(0, 2).toUpperCase();
  const when = new Date(comment.created_at);
  const edited = comment.updated_at && comment.updated_at !== comment.created_at;
  return (
    <div className="flex gap-2">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: colorFor({ profile: comment.profile, user_id: comment.user_id }) }}>
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
              <Button type="button" size="sm" onClick={() => { const v = draft.trim(); if (v) { onUpdate(v); setEditing(false); } }}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(comment.body); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap rounded bg-tcard p-2 text-sm text-tcard-foreground">{comment.body}</div>
        )}
        {!editing && (
          <div className="mt-1 flex gap-3 text-xs text-list-muted">
            {canReply && onToggleReply && (
              <button type="button" className="hover:underline" onClick={onToggleReply}>Reply</button>
            )}
            {isOwn && <button type="button" className="hover:underline" onClick={() => setEditing(true)}>Edit</button>}
            {isOwn && <button type="button" className="hover:underline" onClick={async () => { if (await confirmDlg({ title: "Delete comment?", destructive: true, confirmText: "Delete" })) onDelete(); }}>Delete</button>}
          </div>
        )}
        {replying && onSubmitReply && onReplyBodyChange && (
          <div className="mt-2 space-y-2">
            <MentionField
              value={replyBody ?? ""}
              onChange={onReplyBodyChange}
              members={members}
              placeholder={`Reply to ${name}…`}
              onSubmit={onSubmitReply}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={onSubmitReply}>Reply</Button>
              <Button type="button" size="sm" variant="ghost" onClick={onToggleReply}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MentionField({
  value, onChange, members, placeholder, onSubmit,
  multiline = true, disabled, autoFocus, onBlur, onKeyDown: onKeyDownExtra,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  members: Member[];
  placeholder?: string;
  onSubmit?: () => void;
  multiline?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  const matches = open
    ? members
        .filter((m) => {
          const n = (m.profile?.display_name ?? m.profile?.email ?? "").toLowerCase();
          return n.includes(query.toLowerCase());
        })
        .slice(0, 6)
    : [];

  const handleChange = (v: string) => {
    onChange(v);
    const pos = ref.current?.selectionStart ?? v.length;
    const before = v.slice(0, pos);
    const m = before.match(/(?:^|\s)@([\w.\-]*)$/);
    if (m) {
      setOpen(true);
      setAnchor(pos - m[1].length - 1);
      setQuery(m[1]);
      setActive(0);
    } else {
      setOpen(false);
      setAnchor(null);
    }
  };

  const insertMention = (member: Member) => {
    if (anchor == null) return;
    const name = (member.profile?.display_name ?? member.profile?.email ?? "user").replace(/\s+/g, "");
    const pos = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, anchor);
    const after = value.slice(pos);
    const insert = `@${name} `;
    const next = before + insert + after;
    onChange(next);
    setOpen(false);
    setAnchor(null);
    setQuery("");
    requestAnimationFrame(() => {
      const newPos = (before + insert).length;
      ref.current?.focus();
      (ref.current as any)?.setSelectionRange?.(newPos, newPos);
    });
  };

  const sharedKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    }
    if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    onKeyDownExtra?.(e);
  };

  return (
    <div className="relative">
      {multiline ? (
        <Textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onBlur={onBlur}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={sharedKeyDown}
          placeholder={placeholder}
          className={cn("min-h-[70px] bg-tcard text-tcard-foreground", className)}
        />
      ) : (
        <Input
          ref={ref as React.RefObject<HTMLInputElement>}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onBlur={onBlur}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={sharedKeyDown}
          placeholder={placeholder}
          className={className}
        />
      )}
      {open && matches.length > 0 && (
        <div className="absolute left-2 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {matches.map((m, i) => {
            const name = m.profile?.display_name ?? m.profile?.email ?? "User";
            return (
              <button
                key={m.user_id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-sm text-left", i === active && "bg-accent text-accent-foreground")}
              >
                <Avatar member={m} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{name}</div>
                  {m.profile?.email && <div className="truncate text-xs text-muted-foreground">{m.profile.email}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityBlock({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  const getFn = getCardActivities;
  const { data: activities = [] } = useQuery({
    queryKey: ["activities", cardId],
    queryFn: () => getFn({ cardId }),
    enabled: open,
  });
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left font-semibold"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Activity className="h-4 w-4" />
        <span>Activity</span>
        <span className="ml-1 text-xs font-normal text-list-muted">{open ? "(hide)" : "(show)"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {activities.length === 0 && <div className="text-xs text-list-muted">No activity yet.</div>}
          {(activities as any[]).map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: any }) {
  const name = activity.profile?.display_name ?? activity.profile?.email ?? "Someone";
  const initials = name.slice(0, 2).toUpperCase();
  const when = new Date(activity.created_at);
  const p = activity.payload ?? {};
  const text = describeActivity(activity.type, p);
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: colorFor({ profile: activity.profile, user_id: activity.user_id }) }}>
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-list-foreground">
          <span className="font-semibold">{name}</span> <span>{text}</span>
        </div>
        <div className="text-xs text-list-muted">
          {when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function describeActivity(type: string, p: any): string {
  switch (type) {
    case "card_created": return `created this card${p.title ? ` "${p.title}"` : ""}`;
    case "title_changed": return `renamed the card to "${p.title}"`;
    case "description_changed": return `updated the description`;
    case "due_set": return `set the due date${p.due_date ? ` to ${new Date(p.due_date).toLocaleString()}` : ""}`;
    case "due_removed": return `removed the due date`;
    case "moved": return `moved this card${p.from ? ` from "${p.from}"` : ""}${p.to ? ` to "${p.to}"` : ""}`;
    case "label_added": return `added label "${p.name ?? ""}"`;
    case "label_removed": return `removed label "${p.name ?? ""}"`;
    case "member_added": return `assigned ${p.name ?? "a member"}`;
    case "member_removed": return `unassigned ${p.name ?? "a member"}`;
    case "owner_changed": return `changed the owner to ${p.name ?? "someone"}`;
    case "checklist_added": return `added checklist "${p.title ?? ""}"`;
    case "checklist_item_added": return `added an item: "${p.text ?? ""}"`;
    case "checklist_item_done": return `completed "${p.text ?? ""}"`;
    case "checklist_item_undone": return `unchecked "${p.text ?? ""}"`;
    case "comment_added": return `added a comment`;
    case "comment_replied": return `replied to a comment`;
    default: return type.replace(/_/g, " ");
  }
}

function OwnerPopover({ boardId, cardId, canEdit, members, ownerId }: {
  boardId: string; cardId: string; canEdit: boolean; members: Member[]; ownerId: string | null;
}) {
  const qc = useQueryClient();
  const updFn = updateCardOwner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const current = members.find((m) => m.user_id === ownerId);
  const currentName = current?.profile?.display_name ?? current?.profile?.email ?? (ownerId ? "Unknown" : "No owner");

  const q = query.trim().replace(/^@/, "").toLowerCase();
  const matches = members.filter((m) => {
    if (!q) return true;
    const n = (m.profile?.display_name ?? "").toLowerCase();
    const e = (m.profile?.email ?? "").toLowerCase();
    return n.startsWith(q) || e.startsWith(q);
  }).slice(0, 10);

  const setOwner = useMutation({
    mutationFn: (userId: string) => updFn({ cardId, userId }),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ["board", boardId] });
      const prev = qc.getQueryData<any>(["board", boardId]);
      qc.setQueryData<any>(["board", boardId], (d: any) =>
        d ? { ...d, cards: d.cards.map((c: any) => (c.id === cardId ? { ...c, created_by: userId } : c)) } : d,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["board", boardId], ctx.prev); toast.error(e.message); },
    onSuccess: () => { setOpen(false); setQuery(""); toast.success("Owner updated"); },
  });

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQuery(""); setActive(0); } }}>
      <PopoverTrigger asChild>
        <SidebarButton icon={UserIcon} disabled={!canEdit}>
          <span className="truncate">Owner: {currentName}</span>
        </SidebarButton>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="text-sm font-medium mb-2">Change card owner</div>
        <Input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (matches.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
            else if (e.key === "Enter") { e.preventDefault(); setOwner.mutate(matches[active].user_id); }
          }}
          placeholder="Type @ to see all members…"
          className="h-8 mb-2"
        />
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {matches.map((m, i) => {
            const name = m.profile?.display_name ?? m.profile?.email ?? "User";
            const isOwner = m.user_id === ownerId;
            return (
              <button
                key={m.user_id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => setOwner.mutate(m.user_id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <Avatar member={m} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{name}</div>
                  {m.profile?.email && <div className="truncate text-xs text-muted-foreground">{m.profile.email}</div>}
                </div>
                {isOwner && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
          {matches.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── PM Agent helper components ────────────────────────────────────────────────

function PriorityDots({ value, color }: { value: number; color: "violet" | "orange" }) {
  const filled = color === "violet" ? "bg-violet-500" : "bg-orange-400";
  const empty = "bg-muted";
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("inline-block h-2 w-2 rounded-full", i < value ? filled : empty)} />
      ))}
    </span>
  );
}

function ScorePicker({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: "violet" | "orange" }) {
  const active = color === "violet"
    ? "bg-violet-500 text-white border-violet-500"
    : "bg-orange-400 text-white border-orange-400";
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            "h-6 w-6 rounded border text-xs font-semibold transition-colors",
            value === n ? active : "border-input bg-background text-foreground hover:bg-accent"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}