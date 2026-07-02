#!/usr/bin/env node
/**
 * Forge capability registration — the single writer-of-record protocol used
 * by the /forge-build skill (never hand-edit registry.json in parallel).
 *
 *   node hooks/register_capability.js '{"id":"my-skill","type":"skill",...}'
 *   echo <json> | node hooks/register_capability.js
 *
 * Protocol (avoids the two-writer race on registry.json):
 *   server up   → POST /api/registry ONLY (server owns the file),
 *                 plus a ForgeBuild event so the dashboard announces it live.
 *   server down → atomic upsert directly into data/registry.json
 *                 (tmp + rename); the server re-reads the file on boot and on
 *                 every GET, so the capability appears at next connect.
 *
 * Registration must never fail because observability is off.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SERVER = process.env.FORGE_SERVER_URL || "http://127.0.0.1:4000";
const REGISTRY_FILE = path.join(__dirname, "..", "data", "registry.json");

async function readInput() {
  if (process.argv[2]) return process.argv[2];
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function upsertFile(cap) {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  let reg = { capabilities: [] };
  try { reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); } catch { /* fresh file */ }
  if (!Array.isArray(reg.capabilities)) reg.capabilities = [];
  const i = reg.capabilities.findIndex((c) => c.id === cap.id);
  if (i >= 0) reg.capabilities[i] = { ...reg.capabilities[i], ...cap };
  else reg.capabilities.push({ created: new Date().toISOString(), ...cap });
  const tmp = REGISTRY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, REGISTRY_FILE);
}

async function main() {
  let cap;
  try {
    cap = JSON.parse(await readInput());
  } catch (err) {
    console.error(`register_capability: invalid JSON input (${err.message})`);
    process.exit(1);
  }
  if (!cap.id || !cap.type) {
    console.error('register_capability: "id" and "type" are required');
    process.exit(1);
  }

  let serverUp = false;
  try {
    const res = await fetch(`${SERVER}/api/health`, { signal: AbortSignal.timeout(400) });
    serverUp = res.ok;
  } catch { serverUp = false; }

  if (serverUp) {
    try {
      const res = await fetch(`${SERVER}/api/registry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cap),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      // Announce on the live event log (best effort — never fail registration over it)
      try {
        await fetch(`${SERVER}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_app: "forge",
            session_id: "forge-build",
            hook_event_name: "ForgeBuild",
            timestamp: new Date().toISOString(),
            payload: { name: cap.id, type: cap.type, description: cap.description || "" },
          }),
          signal: AbortSignal.timeout(1000),
        });
      } catch { /* announcement is optional */ }
      console.log(`registered "${cap.id}" via Forge server — live on the dashboard`);
      return;
    } catch (err) {
      // Server answered health but failed the write — fall through to the file.
      console.error(`server registration failed (${err.message}); writing registry file directly`);
    }
  }

  upsertFile(cap);
  console.log(`registered "${cap.id}" in data/registry.json (server offline — appears at next dashboard connect)`);
}

main().catch((err) => { console.error(`register_capability: ${err.message}`); process.exit(1); });
