#!/usr/bin/env node
/**
 * Forge hook sender — Claude Code pipes the hook payload (JSON) to stdin;
 * this forwards it to the Forge server and exits.
 *
 * Contract with Claude Code:
 *  - MUST be fast: 800ms network cap + 2.5s whole-process failsafe.
 *  - MUST be silent: never writes to stdout (UserPromptSubmit stdout is
 *    injected into Claude's context) and always exits 0 so a dead server
 *    never blocks or fails a tool call.
 */
"use strict";

const path = require("path");

// Failsafe: no matter what wedges (stdin never closing, DNS stall), die clean
// long before the hook timeout would surface an error to the user.
setTimeout(() => process.exit(0), 2500).unref();

const SERVER = process.env.FORGE_SERVER_URL || "http://127.0.0.1:4000";
const MAX_STRING = 1200;
const MAX_ARRAY = 20;
const MAX_KEYS = 50;
const MAX_EVENT_BYTES = 100 * 1024;

function truncate(value, depth = 0) {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + ` …[+${value.length - MAX_STRING} chars]` : value;
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => truncate(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`…[+${value.length - MAX_ARRAY} items]`);
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (const k of keys.slice(0, MAX_KEYS)) out[k] = truncate(value[k], depth + 1);
    if (keys.length > MAX_KEYS) out["…"] = `+${keys.length - MAX_KEYS} more keys`;
    return out;
  }
  return value;
}

async function main() {
  let raw = "";
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch { /* no stdin */ }

  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = { unparsed: String(raw).slice(0, 500) }; }

  // --event <Name> lets settings.json tag events if hook_event_name is absent
  const flagIdx = process.argv.indexOf("--event");
  const eventName = payload.hook_event_name || (flagIdx > -1 ? process.argv[flagIdx + 1] : "Unknown");

  const cwd = payload.cwd || process.cwd();
  const event = {
    source_app: path.basename(cwd),
    session_id: payload.session_id || "unknown",
    hook_event_name: eventName,
    timestamp: new Date().toISOString(),
    payload: truncate(payload),
  };

  // Belt and braces: field truncation can still leave a huge event (many
  // mid-size fields). Degrade rather than let the server reject it.
  if (JSON.stringify(event).length > MAX_EVENT_BYTES) {
    event.payload = {
      truncated: true,
      note: "payload exceeded 100KB after field truncation",
      tool_name: payload.tool_name,
      agent_type: payload.agent_type,
    };
  }

  try {
    await fetch(`${SERVER}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(800),
    });
  } catch { /* server down — never block Claude */ }
}

main().finally(() => process.exit(0));
