import { supabase } from "@/integrations/supabase/client";

// ── Edge function caller ───────────────────────────────────────────────────────
// Uses fetch directly so we can pass the JWT from the current session,
// which is more reliable than supabase.functions.invoke() with publishable keys.
async function invokeFunction(name: string, body: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("Not authenticated");

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `Edge function error: ${res.status}`);
  return json;
}

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
  return invokeFunction("pm-agent", data);
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
  return invokeFunction("swe-agent", { action: "start_sprint", board_id: data.board_id });
}

export async function startCard(data: { board_id: string; card_id: string }) {
  return invokeFunction("swe-agent", { action: "start_card", board_id: data.board_id, card_id: data.card_id });
}

export async function answerAgentQuestion(data: {
  board_id: string;
  card_id: string;
  run_id: string;
  answer: string;
}) {
  return invokeFunction("swe-agent", { action: "answer_question", ...data });
}

export async function haltAgent(data: { board_id: string; card_id: string; run_id: string }) {
  return invokeFunction("swe-agent", { action: "halt", ...data });
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
