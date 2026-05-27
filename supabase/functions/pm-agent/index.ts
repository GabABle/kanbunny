import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ── Types ────────────────────────────────────────────────────────────────────
interface PMRequest {
  card_id: string;
  // Optional user-supplied overrides
  user_priority?: number | null; // 1-5
  user_urgency?: number | null;  // 1-5
}

interface PMResponse {
  priority_score: number;
  urgency_score: number;
  rationale: string;
  evaluated_by: "agent" | "user";
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { card_id, user_priority, user_urgency }: PMRequest = await req.json();
    if (!card_id) throw new Error("card_id is required");

    // Build an authed Supabase client using the caller's JWT
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // ── Fetch card context ──────────────────────────────────────────────────
    const { data: card, error: cardErr } = await supabase
      .from("cards")
      .select("id, title, description, due_date, list_id")
      .eq("id", card_id)
      .single();
    if (cardErr || !card) throw new Error(cardErr?.message ?? "Card not found");

    const { data: listRow } = await supabase
      .from("lists")
      .select("title, board_id")
      .eq("id", card.list_id)
      .single();

    const { data: checklists } = await supabase
      .from("checklists")
      .select("title, id")
      .eq("card_id", card_id);

    const checklistIds = (checklists ?? []).map((c: any) => c.id);
    const { data: items } = checklistIds.length
      ? await supabase
          .from("checklist_items")
          .select("text, done, checklist_id")
          .in("checklist_id", checklistIds)
      : { data: [] };

    const { data: cardLabels } = await supabase
      .from("card_labels")
      .select("label_id")
      .eq("card_id", card_id);

    const labelIds = (cardLabels ?? []).map((cl: any) => cl.label_id);
    const { data: labels } = labelIds.length
      ? await supabase.from("labels").select("name, color").in("id", labelIds)
      : { data: [] };

    // ── Log run start ───────────────────────────────────────────────────────
    const { data: { user } } = await supabase.auth.getUser();
    const { data: runRow } = await supabase
      .from("agent_runs")
      .insert({
        board_id: listRow!.board_id,
        card_id,
        agent_type: "pm",
        status: "running",
        started_by: user!.id,
        log: [{ t: new Date().toISOString(), msg: "PM Agent started" }],
      })
      .select("id")
      .single();
    const runId = runRow?.id;

    // ── Handle user overrides ───────────────────────────────────────────────
    let result: PMResponse;

    if (user_priority != null && user_urgency != null) {
      result = {
        priority_score: user_priority,
        urgency_score: user_urgency,
        rationale: "Manually set by user.",
        evaluated_by: "user",
      };
    } else {
      // ── Build Claude prompt ──────────────────────────────────────────────
      const checklistSummary = (checklists ?? []).map((cl: any) => {
        const clItems = (items ?? []).filter((i: any) => i.checklist_id === cl.id);
        const done = clItems.filter((i: any) => i.done).length;
        return `  Checklist "${cl.title}" (${done}/${clItems.length} done): ${clItems.map((i: any) => i.text).join(", ")}`;
      }).join("\n");

      const prompt = `You are a product manager evaluating a Kanban card.

Card details:
- Board list: ${listRow?.title ?? "Unknown"}
- Title: ${card.title}
- Description: ${card.description ?? "(none)"}
- Due date: ${card.due_date ?? "(none)"}
- Labels: ${(labels ?? []).map((l: any) => l.name).join(", ") || "(none)"}
${checklistSummary ? `- Checklists:\n${checklistSummary}` : ""}

Evaluate this card using the Eisenhower matrix. Return ONLY valid JSON in this exact shape (no markdown, no explanation outside the JSON):
{
  "priority_score": <integer 1-5, where 5 = highest impact>,
  "urgency_score": <integer 1-5, where 5 = most urgent>,
  "rationale": "<one sentence explaining the scores>"
}`;

      // ── Call Claude API ──────────────────────────────────────────────────
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        throw new Error(`Claude API error: ${err}`);
      }

      const claudeData = await claudeRes.json();
      const raw = claudeData.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(raw);

      result = {
        priority_score: Math.min(5, Math.max(1, Number(parsed.priority_score) || 3)),
        urgency_score: Math.min(5, Math.max(1, Number(parsed.urgency_score) || 3)),
        rationale: String(parsed.rationale ?? ""),
        evaluated_by: "agent",
      };
    }

    // ── Upsert card_ai_meta ─────────────────────────────────────────────────
    await supabase.from("card_ai_meta").upsert(
      {
        card_id,
        priority_score: result.priority_score,
        urgency_score: result.urgency_score,
        rationale: result.rationale,
        evaluated_by: result.evaluated_by,
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "card_id" }
    );

    // ── Update cards table ──────────────────────────────────────────────────
    await supabase.from("cards").update({
      ai_priority: result.priority_score,
      ai_urgency: result.urgency_score,
    }).eq("id", card_id);

    // ── Post rationale comment ──────────────────────────────────────────────
    const emoji = result.evaluated_by === "user" ? "📌" : "🧠";
    const priorityStars = "★".repeat(result.priority_score) + "☆".repeat(5 - result.priority_score);
    const urgencyStars = "★".repeat(result.urgency_score) + "☆".repeat(5 - result.urgency_score);
    const commentBody =
      `${emoji} **PM Agent evaluation**\n` +
      `Priority: ${priorityStars} (${result.priority_score}/5)  ·  Urgency: ${urgencyStars} (${result.urgency_score}/5)\n\n` +
      `_${result.rationale}_`;

    await supabase.from("card_comments").insert({
      card_id,
      user_id: user!.id,
      body: commentBody,
    });

    // ── Complete run ────────────────────────────────────────────────────────
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "done",
        log: [
          { t: new Date().toISOString(), msg: "PM Agent completed", result },
        ],
      }).eq("id", runId);
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[pm-agent]", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
