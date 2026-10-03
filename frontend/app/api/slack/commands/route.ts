import { after, NextResponse } from "next/server";

import { logEvent, logServerError } from "@/lib/logger";
import { help, isSlowCommand, parseCommandText, runSlashCommand, type SlackMessage } from "@/lib/slack/commands";
import { allowedSlackUsers, verifySlackSignature } from "@/lib/slack/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: SlackMessage & { response_type: "ephemeral" | "in_channel" }) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

function ephemeral(text: string) {
  return reply({ response_type: "ephemeral", text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] });
}

/**
 * Slack slash command endpoint for `/gazette <command>`. Slack gives up after
 * 3 seconds, so commands that read the database are acknowledged at once and
 * their answer is posted to the command's `response_url` afterwards.
 * Read-only: nothing here generates editions or changes data.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifySlackSignature(rawBody, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const userId = form.get("user_id") ?? "";
  const responseUrl = form.get("response_url");

  if (!allowedSlackUsers().has(userId)) {
    logEvent("warn", "slack.command_denied", { userId, team: form.get("team_domain") });
    return ephemeral(`You're not allowed to use this command. To allow it, add your Slack user ID \`${userId}\` to \`SLACK_ALLOWED_USERS\`.`);
  }

  const command = parseCommandText(form.get("text") ?? "");
  const responseType = command.inChannel ? "in_channel" : "ephemeral";
  logEvent("info", "slack.command", { userId, command: command.name, args: command.args.join(" ") });

  if (!isSlowCommand(command.name) || !responseUrl) {
    return reply({ response_type: "ephemeral", ...help(command.name === "help" ? undefined : command.name) });
  }

  after(async () => {
    let result: SlackMessage;
    try {
      result = await runSlashCommand(command);
    } catch (error) {
      logServerError("slack.command_failed", error, { command: command.name });
      const reason = error instanceof Error ? error.name : "error";
      result = { text: `⚠️ \`/gazette ${command.name}\` failed (${reason}). Details are in the server logs.` };
    }

    try {
      const response = await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An ephemeral answer replaces the "working…" note; a public one is a new message.
        body: JSON.stringify({ response_type: responseType, replace_original: !command.inChannel, ...result }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) logEvent("warn", "slack.response_failed", { command: command.name, status: response.status });
    } catch (error) {
      logServerError("slack.response_failed", error, { command: command.name });
    }
  });

  return ephemeral(`⏳ Working on \`/gazette ${[command.name, ...command.args].join(" ")}\`…`);
}
