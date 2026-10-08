#!/usr/bin/env node
/**
 * Forge server — receives Claude Code hook events, persists them to JSONL,
 * and streams them to the dashboard over Server-Sent Events.
 *
 * Zero dependencies. Node 18+. Local-only by design: binds 127.0.0.1 and
 * sends no CORS headers (the dashboard is same-origin; a wildcard here would
 * let any webpage you visit read your prompts).
 *
 * Binding to loopback is not enough on its own, so every request is also
 * checked against a local Host allowlist (blocks DNS rebinding), and every
 * write must carry a local Origin — or none, as Node fetch / curl send — plus
 * Content-Type: application/json (blocks cross-site "simple" POSTs). See the
 * request guards below.
 *
 *   node server/server.js          → http://127.0.0.1:4000
 *   FORGE_PORT=5000 node server/server.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.FORGE_PORT) || 4000;
const HOST = "127.0.0.1";
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const DASHBOARD = path.join(ROOT, "dashboard", "index.html");

const MAX_MEMORY_EVENTS = 3000;      // ring buffer served to dashboard clients
const MAX_BODY_BYTES = 512 * 1024;
const ROTATE_BYTES = 50 * 1024 * 1024;
const BOOT_MS = Date.now();          // sync clients detect restarts by boot stamp

fs.mkdirSync(DATA_DIR, { recursive: true });

// Transcript viewing is restricted to *.jsonl session files that really live
// under ~/.claude/projects — never the rest of ~/.claude (e.g. .credentials.json)
let TRANSCRIPT_ROOT = null;
try { TRANSCRIPT_ROOT = fs.realpathSync(path.join(os.homedir(), ".claude", "projects")); } catch { /* no ~/.claude/projects yet */ }

// ---------------------------------------------------------------- request guards
// The server only listens on 127.0.0.1, but a webpage can still reach it:
//  - DNS rebinding: a page on attacker.example re-pointed to 127.0.0.1 becomes
//    same-origin, so the missing CORS headers no longer protect reads.
//  - CSRF: a cross-site fetch(..., { mode: "no-cors", body }) sends text/plain
//    with no preflight; the write lands even though the response is unreadable.
// So: every request must carry a local Host, and every POST must come from a
// local Origin (or none — Node fetch / curl send no Origin) with a JSON body.
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const LOCAL_ORIGINS = new Set([...LOCAL_HOSTS].map((h) => `http://${h}`));

function isLocalHost(req) {
  return LOCAL_HOSTS.has(String(req.headers.host || "").trim().toLowerCase());
}

function isLocalWrite(req) {
  const origin = req.headers.origin;
  if (origin !== undefined && !LOCAL_ORIGINS.has(String(origin).trim().toLowerCase())) return false;
  const ct = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  return ct === "application/json";
}

// ---------------------------------------------------------------- state
let events = [];       // in-memory ring
let nextId = 1;
let totalEvents = 0;   // running total for the current log file (survives the ring cap)
const sseClients = new Set();

function bootLoad() {
  if (!fs.existsSync(EVENTS_FILE)) return;
  try {
    if (fs.statSync(EVENTS_FILE).size > ROTATE_BYTES) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(EVENTS_FILE, path.join(DATA_DIR, `events-${stamp}.jsonl`));
      console.log(`[forge] rotated oversized events.jsonl → events-${stamp}.jsonl`);
      return;
    }
    const lines = fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean);
    totalEvents = lines.length;
    for (const line of lines.slice(-MAX_MEMORY_EVENTS)) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev === "object") events.push(ev);
      } catch { /* skip corrupt line */ }
    }
    // Trust persisted ids (click-to-inspect and catch-up key on them);
    // continue numbering above the max ever written.
    let maxId = 0;
    for (const ev of events) if (Number.isFinite(ev.id)) maxId = Math.max(maxId, ev.id);
    nextId = maxId + 1;
    for (const ev of events) if (!Number.isFinite(ev.id)) ev.id = nextId++;
    events.sort((a, b) => a.id - b.id);
    console.log(`[forge] loaded ${events.length} of ${totalEvents} events from ${path.basename(EVENTS_FILE)}`);
  } catch (err) {
    console.warn(`[forge] could not load history: ${err.message}`);
  }
}

bootLoad();

// Single persistent append handle: ordered writes, minimal lock exposure.
const logStream = fs.createWriteStream(EVENTS_FILE, { flags: "a" });
let logStreamErrored = false;
logStream.on("error", (err) => {
  if (!logStreamErrored) console.warn(`[forge] event log write failed (events stay in memory): ${err.message}`);
  logStreamErrored = true;
});

function readRegistry() {
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    if (Array.isArray(reg.capabilities)) return reg;
  } catch { /* fall through */ }
  return { capabilities: [] };
}

function writeRegistry(reg) {
  const tmp = REGISTRY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, REGISTRY_FILE);
}

// ---------------------------------------------------------------- SSE
function broadcast(eventName, data) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch { sseClients.delete(res); }
  }
}

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(": ping\n\n"); } catch { sseClients.delete(res); }
  }
}, 25000).unref();

// ---------------------------------------------------------------- helpers
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function ingest(raw) {
  const ev = {
    id: nextId++,
    received_at: new Date().toISOString(),
    source_app: String(raw.source_app || "unknown"),
    session_id: String(raw.session_id || "unknown"),
    hook_event_name: String(raw.hook_event_name || raw.hook_event_type || "Unknown"),
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : {},
    timestamp: raw.timestamp || new Date().toISOString(),
  };
  events.push(ev);
  if (events.length > MAX_MEMORY_EVENTS) events = events.slice(-MAX_MEMORY_EVENTS);
  totalEvents++;
  logStream.write(JSON.stringify(ev) + "\n");
  broadcast("ev", ev);
  return ev;
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  // Host allowlist: a DNS-rebound page sends its own hostname here.
  if (!isLocalHost(req)) {
    return json(res, 403, { error: "forbidden: Host must be 127.0.0.1:" + PORT + " or localhost:" + PORT });
  }
  // Writes: local Origin (or none) + JSON Content-Type. A browser cannot send
  // application/json cross-site without a CORS preflight, which we never answer.
  if (req.method === "POST" && !isLocalWrite(req)) {
    return json(res, 403, { error: "forbidden: cross-site write (local Origin and Content-Type: application/json required)" });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Dashboard
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const html = fs.readFileSync(DASHBOARD);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      return json(res, 500, { error: "dashboard/index.html not found" });
    }
  }

  // Transport probe page (diagnostics): how large a response reaches the browser?
  if (req.method === "GET" && url.pathname === "/probe") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!DOCTYPE html><title>P</title><script>
      (async () => {
        for (const n of [10, 100, 400, 1000, 3000]) {
          const t0 = performance.now();
          try {
            const r = await Promise.race([
              fetch("/api/events?limit=" + n, {cache: "no-store"}).then(x => x.text()),
              new Promise((_, rej) => setTimeout(() => rej(new Error("TO")), 4000)),
            ]);
            document.title += " " + n + ":" + Math.round(r.length/1024) + "K/" + Math.round(performance.now() - t0) + "ms";
          } catch (e) { document.title += " " + n + ":" + e.message; }
        }
        document.title += " DONE";
      })();
    <\/script>`);
  }

  // Hook event ingestion
  if (req.method === "POST" && url.pathname === "/events") {
    try {
      const raw = JSON.parse((await readBody(req)) || "{}");
      const ev = ingest(raw);
      return json(res, 200, { ok: true, id: ev.id });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // Incremental sync — the dashboard's transport. Complete responses only:
  // streaming bodies to browsers can be buffered indefinitely by network-
  // inspection software, so the client polls this instead of holding /stream.
  if (req.method === "GET" && url.pathname === "/api/sync") {
    const after = Number(url.searchParams.get("after")) || 0;
    // page size keeps each response well under the ~250KB ceiling some
    // network-inspection software imposes on browser-bound responses
    // (observed: ~226KB delivered, ~340KB eaten — stay conservative)
    const PAGE = 80;
    const pending = after > 0 ? events.filter((e) => e.id > after) : events;
    return json(res, 200, {
      boot: BOOT_MS,
      events: pending.slice(0, PAGE),
      more: pending.length > PAGE,
      registry: readRegistry(),
      totals: { events: totalEvents },
    });
  }

  // Recent events
  if (req.method === "GET" && url.pathname === "/api/events") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 500, MAX_MEMORY_EVENTS);
    return json(res, 200, events.slice(-limit));
  }

  // Forge registry — capabilities forged by /forge-build
  if (url.pathname === "/api/registry") {
    if (req.method === "GET") return json(res, 200, readRegistry());
    if (req.method === "POST") {
      try {
        const cap = JSON.parse((await readBody(req)) || "{}");
        if (!cap.id || !cap.type) return json(res, 400, { ok: false, error: "id and type required" });
        const reg = readRegistry();
        const i = reg.capabilities.findIndex((c) => c.id === cap.id);
        if (i >= 0) reg.capabilities[i] = { ...reg.capabilities[i], ...cap };
        else reg.capabilities.push({ created: new Date().toISOString(), ...cap });
        writeRegistry(reg);
        broadcast("registry", reg);
        return json(res, 200, { ok: true, count: reg.capabilities.length });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message });
      }
    }
  }

  // Per-session transcript (drill-down) — hardened to *.jsonl under ~/.claude/projects only
  if (req.method === "GET" && url.pathname === "/api/transcript") {
    const p = url.searchParams.get("path") || "";
    if (!TRANSCRIPT_ROOT) return json(res, 404, { error: "~/.claude/projects not found" });
    try {
      const resolved = fs.realpathSync(path.resolve(p)); // throws if missing; collapses ../, 8.3 names, symlinks
      if (!resolved.toLowerCase().startsWith(TRANSCRIPT_ROOT.toLowerCase() + path.sep) ||
          path.extname(resolved).toLowerCase() !== ".jsonl") {
        return json(res, 403, { error: "only *.jsonl transcripts under ~/.claude/projects are served" });
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return json(res, 403, { error: "not a regular file" });
      const start = Math.max(0, stat.size - 2 * 1024 * 1024); // tail 2MB max
      const buf = Buffer.alloc(stat.size - start);
      const fd = fs.openSync(resolved, "r");
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      let text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop partial first line
      const entries = text.split("\n").filter(Boolean).slice(-2000).map((l) => {
        try { return JSON.parse(l); } catch { return { raw: l.slice(0, 500) }; }
      });
      return json(res, 200, { path: resolved, count: entries.length, entries });
    } catch {
      return json(res, 404, { error: "transcript not found or unreadable" });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      uptime_s: Math.round(process.uptime()),
      events_in_memory: events.length,
      total_events: totalEvents,
      clients: sseClients.size,
    });
  }

  // Live stream — /stream speaks standard SSE (curl, EventSource);
  // /wire carries identical frames as an opaque octet stream (the dashboard
  // uses this: some network-inspection layers buffer text/event-stream
  // responses to browsers indefinitely, which stalls the connection).
  if (req.method === "GET" && (url.pathname === "/stream" || url.pathname === "/wire")) {
    res.writeHead(200, url.pathname === "/wire"
      ? { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" }
      : { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    if (res.flushHeaders) res.flushHeaders();
    if (res.socket && res.socket.setNoDelay) res.socket.setNoDelay(true);
    res.write(`event: init\ndata: ${JSON.stringify({ events, registry: readRegistry(), totals: { events: totalEvents } })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  json(res, 404, { error: "not found" });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ⚒  FORGE is already running (port ${PORT} in use) — dashboard: http://${HOST}:${PORT}`);
    console.error(`     To run a second instance:  set FORGE_PORT=4001 && node server\\server.js\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ⚒  FORGE server running`);
  console.log(`     dashboard  → http://${HOST}:${PORT}`);
  console.log(`     ingest     → POST http://${HOST}:${PORT}/events`);
  console.log(`     stream     → GET  http://${HOST}:${PORT}/stream\n`);
});
