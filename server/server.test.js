"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const entry = { type: "message", text: "synthetic transcript" };
let fixture;
let home;
let claudeHome;
let allowedFile;
let outsideFile;
let server;
let baseUrl;

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "forge-transcript-test-"));
  home = path.join(fixture, "home");
  claudeHome = path.join(home, ".claude");
  allowedFile = path.join(claudeHome, "projects", "session.jsonl");
  outsideFile = path.join(home, ".claude-other", "session.jsonl");
  for (const file of [allowedFile, outsideFile]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry) + "\n");
  }
  const serverFile = path.join(fixture, "server", "server.js");
  fs.mkdirSync(path.dirname(serverFile), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "server.js"), serverFile);

  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [serverFile], {
    env: { ...process.env, HOME: home, USERPROFILE: home, FORGE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  server.stderr.on("data", chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server startup timed out: ${errors}`)), 5000);
    server.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("FORGE server running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${errors}`));
    });
  });
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

async function transcript(file) {
  const query = new URLSearchParams({ path: file });
  const response = await fetch(`${baseUrl}/api/transcript?${query}`, {
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

test("reads a transcript inside ~/.claude", async () => {
  const result = await transcript(allowedFile);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.entries, [entry]);
});

test("rejects a sibling with the same directory prefix", async () => {
  const result = await transcript(outsideFile);
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "path outside ~/.claude");
});

test("rejects traversal outside ~/.claude", async () => {
  const file = `${claudeHome}${path.sep}..${path.sep}.claude-other${path.sep}session.jsonl`;
  assert.equal((await transcript(file)).status, 403);
});

test("rejects a case-distinct sibling on a case-sensitive filesystem", async t => {
  const sibling = path.join(home, ".CLAUDE");
  if (fs.existsSync(sibling)) {
    t.skip("filesystem treats .claude and .CLAUDE as the same directory");
    return;
  }
  fs.mkdirSync(sibling);
  const file = path.join(sibling, "session.jsonl");
  fs.writeFileSync(file, JSON.stringify(entry) + "\n");
  const result = await transcript(file);
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "path outside ~/.claude");
});

test("allows a child directory whose name starts with two dots", async () => {
  const file = path.join(claudeHome, "..archive", "session.jsonl");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(entry) + "\n");
  assert.equal((await transcript(file)).status, 200);
});

test("rejects a symlink to a directory outside ~/.claude", async t => {
  const link = path.join(claudeHome, "linked");
  try {
    fs.symlinkSync(path.dirname(outsideFile), link, "junction");
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    t.skip("creating symlinks is not permitted");
    return;
  }
  assert.equal((await transcript(path.join(link, "session.jsonl"))).status, 403);
});

test("returns not found for a missing transcript", async () => {
  assert.equal((await transcript(path.join(claudeHome, "missing.jsonl"))).status, 404);
});
