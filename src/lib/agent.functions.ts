import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CardAIMeta {
  card_id: string;
  priority_score: number;
  urgency_score: number;
  rationale: string | null;
  evaluated_at: string;
  evaluated_by: string;
}

export interface AgentRun {
  id: string;
  board_id: string;
  card_id: string | null;
  agent_type: "pm" | "swe";
  status: "running" | "paused" | "done" | "halted" | "error";
  log: { t: string; msg: string; [key: string]: unknown }[];
  created_at: string;
  updated_at: string;
}

// ── PM Agent ──────────────────────────────────────────────────────────────────

export async function runPMAgent(data: {
  card_id: string;
  user_priority?: number | null;
  user_urgency?: number | null;
}): Promise<{ ok: boolean; priority_score?: number; urgency_score?: number; rationale?: string; error?: string }> {
  const { data: result, error } = await supabase.functions.invoke("pm-agent", {
    body: data,
  });
  if (error) throw new Error(error.message);
  return result;
}

export async function getCardAIMeta(data: { cardId: string }): Promise<CardAIMeta | null> {
  const { data: row, error } = await supabase
    .from("card_ai_meta")
    .select("*")
    .eq("card_id", data.cardId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return row ?? null;
}

export async function setManualPriority(data: {
  card_id: string;
  priority: number;
  urgency: number;
}): Promise<{ ok: boolean }> {
  return runPMAgent({
    card_id: data.card_id,
    user_priority: data.priority,
    user_urgency: data.urgency,
  });
}

// ── SWE Agent ─────────────────────────────────────────────────────────────────

export async function startSprint(data: { board_id: string }) {
  const { data: result, error } = await supabase.functions.invoke("swe-agent", {
    body: { action: "start_sprint", board_id: data.board_id },
  });
  if (error) throw new Error(error.message);
  return result;
}

export async function startCard(data: { board_id: string; card_id: string }) {
  const { data: result, error } = await supabase.functions.invoke("swe-agent", {
    body: { action: "start_card", board_id: data.board_id, card_id: data.card_id },
  });
  if (error) throw new Error(error.message);
  return result;
}

export async function answerAgentQuestion(data: {
  board_id: string;
  card_id: string;
  run_id: string;
  answer: string;
}) {
  const { data: result, error } = await supabase.functions.invoke("swe-agent", {
    body: { action: "answer_question", ...data },
  });
  if (error) throw new Error(error.message);
  return result;
}

export async function haltAgent(data: { board_id: string; card_id: string; run_id: string }) {
  const { data: result, error } = await supabase.functions.invoke("swe-agent", {
    body: { action: "halt", ...data },
  });
  if (error) throw new Error(error.message);
  return result;
}

// ── Agent runs queries ────────────────────────────────────────────────────────

export async function getActiveAgentRuns(data: { boardId: string }): Promise<AgentRun[]> {
  const { data: rows, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("board_id", data.boardId)
    .in("status", ["running", "paused"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (rows ?? []) as AgentRun[];
}

export async function getCardAgentRuns(data: { cardId: string }): Promise<AgentRun[]> {
  const { data: rows, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("card_id", data.cardId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (rows ?? []) as AgentRun[];
}
