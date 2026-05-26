import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export interface SendAssignedEmailParams {
  to: string;
  recipientName: string | null;
  actorName: string;
  cardTitle: string;
  boardTitle: string | null;
  boardId: string | null;
}

const emailSchema = z.string().email().max(254);

export async function sendAssignedEmail(params: SendAssignedEmailParams) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

  const to = emailSchema.parse(params.to);
  const greeting = params.recipientName ? `Hi ${escapeHtml(params.recipientName)},` : "Hi,";
  const boardLine = params.boardTitle ? ` on the board "<strong>${escapeHtml(params.boardTitle)}</strong>"` : "";
  const appUrl = process.env.APP_URL || "";
  const link = appUrl && params.boardId ? `${appUrl}/boards/${params.boardId}` : null;
  const cta = link
    ? `<p><a href="${link}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open board</a></p>`
    : "";

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#111;padding:20px">
    <p>${greeting}</p>
    <p><strong>${escapeHtml(params.actorName)}</strong> assigned you to a card${boardLine}.</p>
    <p style="font-size:16px"><strong>${escapeHtml(params.cardTitle)}</strong></p>
    ${cta}
    <p style="color:#888;font-size:12px;margin-top:32px">You're receiving this because you were tagged on a card.</p>
  </body></html>`;

  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": RESEND_API_KEY,
    },
    body: JSON.stringify({
      from: "Notifications <onboarding@resend.dev>",
      to: [to],
      subject: `${params.actorName} assigned you to "${params.cardTitle}"`,
      html,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API call failed [${res.status}]: ${JSON.stringify(body)}`);
  }
  return body;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}