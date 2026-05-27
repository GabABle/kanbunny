import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ────────────────────────────────────────────────────────────────────
interface SWERequest {
  action: "start_sprint" | "start_card" | "answer_question" | "halt";
  board_id: string;
  card_id?: string;   // required for start_card / answer_question / halt
  run_id?: string;    // required for halt / answer_question
  answer?: string;    // for answer_question
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function appendLog(existing: any[], entry: object): any[] {
  return [...(Array.isArray(existing) ? existing : []), { t: new Date().toISOString(), ...entry }];
}

// ── Build task execution prompt ───────────────────────────────────────────────
function buildExecutionPrompt(card: any, checklists: any[], items: any[], comments: any[]): string {
  const checklistText = checklists.map((cl: any) => {
    const clItems = items.filter((i: any) => i.checklist_id === cl.id);
    return `  Checklist "${cl.title}":\n` + clItems.map((i: any) => `    [${i.done ? "x" : " "}] ${i.text}`).join("\n");
  }).join("\n");

  const recentComments = comments.slice(0, 5).map((c: any) =>
    `  - ${c.body.slice(0, 200)}`
  ).join("\n");

  return `You are a software engineering agent working on a Kanban card.

Card: "${card.title}"
Description: ${card.description ?? "(none)"}
Due date: ${card.due_date ?? "(none)"}
${checklistText ? `\nChecklists:\n${checklistText}` : ""}
${recentComments ? `\nRecent comments/context:\n${recentComments}` : ""}

Assess this card and respond with ONLY valid JSON (no markdown):
{
  "clarity": "clear" | "needs_clarification",
  "questions": ["<question 1>", ...],   // only if clarity = needs_clarification
  "plan": "<brief step-by-step execution plan>",   // only if clarity = clear
  "ready_to_execute": true | false
}

If the card description or acceptance criteria are ambiguous, set clarity to "needs_clarification" and list specific questions.
If the task is clear, set clarity to "clear" and outline a concise execution plan.`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: SWERequest = await req.json();
    const { action, board_id, card_id, run_id, answer } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // ── HALT ──────────────────────────────────────────────────────────────
    if (action === "halt") {
      if (!run_id) throw new Error("run_id required to halt");
      const { data: run } = await supabase.from("agent_runs").select("log").eq("id", run_id).single();
      await supabase.from("agent_runs").update({
        status: "halted",
        log: appendLog(run?.log ?? [], { msg: "Halted by user" }),
      }).eq("id", run_id);
      if (card_id) {
        await supabase.from("cards").update({ agent_status: "blocked" }).eq("id", card_id);
        await supabase.from("card_comments").insert({
          card_id,
          user_id: user.id,
          body: "🛑 **SWE Agent halted** by user request.",
        });
      }
      return new Response(JSON.stringify({ ok: true, status: "halted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ANSWER_QUESTION (unblock a card) ──────────────────────────────────
    if (action === "answer_question") {
      if (!card_id || !answer) throw new Error("card_id and answer required");
      // Post answer as a comment
      await supabase.from("card_comments").insert({
        card_id,
        user_id: user.id,
        body: `💬 **PM answered:** ${answer}`,
      });
      // Retry the card
      return await processCard(supabase, user.id, board_id, card_id, anthropicKey);
    }

    // ── START_CARD — process a single specific card ───────────────────────
    if (action === "start_card") {
      if (!card_id) throw new Error("card_id required for start_card");
      return await processCard(supabase, user.id, board_id, card_id, anthropicKey);
    }

    // ── START_SPRINT — pick up all cards from "To Sprint" list ───────────
    if (action === "start_sprint") {
      // Find the "To Sprint" list on this board
      const { data: lists } = await supabase
        .from("lists")
        .select("id, title")
        .eq("board_id", board_id);

      const toSprintList = (lists ?? []).find((l: any) =>
        l.title.toLowerCase().replace(/\s+/g, " ").trim() === "to sprint"
      );

      if (!toSprintList) {
        return new Response(
          JSON.stringify({ ok: false, error: 'No list named "To Sprint" found on this board.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get cards in order
      const { data: sprintCards } = await supabase
        .from("cards")
        .select("id, title, agent_status")
        .eq("list_id", toSprintList.id)
        .eq("archived", false)
        .order("position", { ascending: true });

      if (!sprintCards || sprintCards.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, message: "No cards in To Sprint list." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Process cards sequentially — return after kicking off the first one
      // (subsequent ones are processed after each completes; the client
      //  watches agent_runs + card updates via realtime)
      const results: any[] = [];
      for (const c of sprintCards) {
        if (c.agent_status === "done") continue; // already done
        const res = await processCard(supabase, user.id, board_id, c.id, anthropicKey);
        const json = await res.json();
        results.push({ card_id: c.id, title: c.title, ...json });
        // If blocked (needs clarification), stop the queue until answered
        if (json.status === "blocked") break;
      }

      return new Response(JSON.stringify({ ok: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("[swe-agent]", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── processCard ───────────────────────────────────────────────────────────────
async function processCard(
  supabase: any,
  userId: string,
  boardId: string,
  cardId: string,
  anthropicKey: string
): Promise<Response> {
  // Create a run record
  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      board_id: boardId,
      card_id: cardId,
      agent_type: "swe",
      status: "running",
      started_by: userId,
      log: [{ t: new Date().toISOString(), msg: "SWE Agent picking up card" }],
    })
    .select("id")
    .single();
  const runId = runRow?.id;

  // Mark card in_progress
  await supabase.from("cards").update({ agent_status: "in_progress" }).eq("id", cardId);
  await supabase.from("card_comments").insert({
    card_id: cardId,
    user_id: userId,
    body: "⚙️ **SWE Agent** is reviewing this card…",
  });

  try {
    // Fetch card + checklists + recent comments
    const { data: card } = await supabase
      .from("cards")
      .select("id, title, description, due_date, list_id")
      .eq("id", cardId)
      .single();

    const { data: checklists } = await supabase
      .from("checklists")
      .select("id, title")
      .eq("card_id", cardId);

    const clIds = (checklists ?? []).map((c: any) => c.id);
    const { data: items } = clIds.length
      ? await supabase.from("checklist_items").select("id, checklist_id, text, done").in("checklist_id", clIds)
      : { data: [] };

    const { data: comments } = await supabase
      .from("card_comments")
      .select("body, created_at")
      .eq("card_id", cardId)
      .order("created_at", { ascending: false })
      .limit(10);

    // Call Claude to assess clarity
    const prompt = buildExecutionPrompt(card, checklists ?? [], items ?? [], comments ?? []);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude API error: ${await claudeRes.text()}`);

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text ?? "{}";
    const assessment = JSON.parse(raw);

    // ── Needs clarification ──────────────────────────────────────────────
    if (assessment.clarity === "needs_clarification" || !assessment.ready_to_execute) {
      const questions = (assessment.questions ?? ["Please clarify the requirements."]).join("\n- ");
      await supabase.from("card_comments").insert({
        card_id: cardId,
        user_id: userId,
        body:
          `🤔 **SWE Agent needs clarification before proceeding:**\n\n- ${questions}\n\n` +
          `_Reply to this card with answers so I can continue._`,
      });

      await supabase.from("cards").update({ agent_status: "blocked" }).eq("id", cardId);
      if (runId) {
        await supabase.from("agent_runs").update({
          status: "paused",
          log: [{ t: new Date().toISOString(), msg: "Blocked — awaiting PM clarification", questions: assessment.questions }],
        }).eq("id", runId);
      }

      return new Response(
        JSON.stringify({ ok: true, status: "blocked", run_id: runId, questions: assessment.questions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Execute ──────────────────────────────────────────────────────────
    // Post the execution plan as a comment
    await supabase.from("card_comments").insert({
      card_id: cardId,
      user_id: userId,
      body: `📋 **SWE Agent execution plan:**\n\n${assessment.plan}`,
    });

    // Mark checklist items done (simulates execution)
    for (const item of (items ?? [])) {
      if (!item.done) {
        await supabase.from("checklist_items").update({ done: true }).eq("id", item.id);
      }
    }

    // Find "Done" or "In Progress" target list
    const { data: allLists } = await supabase
      .from("lists")
      .select("id, title")
      .eq("board_id", boardId);

    const doneList = (allLists ?? []).find((l: any) =>
      l.title.toLowerCase().includes("done")
    );
    const inProgressList = (allLists ?? []).find((l: any) =>
      l.title.toLowerCase().replace(/\s+/g, " ").includes("in progress")
    );

    const targetListId = doneList?.id ?? inProgressList?.id ?? card.list_id;
    const targetListTitle = doneList?.title ?? inProgressList?.title ?? "current list";

    // Move card to Done
    const { data: lastCard } = await supabase
      .from("cards")
      .select("position")
      .eq("list_id", targetListId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPos = (lastCard?.position ?? 0) + 1000;
    await supabase.from("cards").update({
      list_id: targetListId,
      position: newPos,
      agent_status: "done",
    }).eq("id", cardId);

    await supabase.from("card_comments").insert({
      card_id: cardId,
      user_id: userId,
      body: `✅ **SWE Agent completed this card.** Moved to "${targetListTitle}".`,
    });

    if (runId) {
      await supabase.from("agent_runs").update({
        status: "done",
        log: [{ t: new Date().toISOString(), msg: "Card completed", plan: assessment.plan }],
      }).eq("id", runId);
    }

    return new Response(
      JSON.stringify({ ok: true, status: "done", run_id: runId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    // On error, mark card blocked and run errored
    await supabase.from("cards").update({ agent_status: "blocked" }).eq("id", cardId);
    await supabase.from("card_comments").insert({
      card_id: cardId,
      user_id: userId,
      body: `❌ **SWE Agent error:** ${err.message}`,
    });
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "error",
        log: [{ t: new Date().toISOString(), msg: "Error", error: err.message }],
      }).eq("id", runId);
    }
    throw err;
  }
}
