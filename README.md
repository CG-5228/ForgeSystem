# ⚒ FORGE — mission control for Claude Code agents

A localhost terminal-style **mission control**: every Claude Code session on this PC
streams onto a live board — their **build tasks as a tiered node pipeline** (pending ·
in-progress ▸ · verified ✓ · cyan ◇ compliance rules), a `SELECTED NODE` inspector,
a `LIVE LOG`, a rules ticker, `LINE: FREE/BUSY/WAITING` status, and an elapsed run
timer. Plus two meta-skills: `/forge-plan` runs whole builds on the board;
`/forge-build` forges new skills/agents.

Everything is local: server binds `127.0.0.1`, data stays in `data/`, zero npm
dependencies (Node 18+).

## Quickstart

```
node server\server.js        (or double-click start-forge.cmd)
```

Open **http://localhost:4000**. Hooks are installed machine-wide
(`~/.claude/settings.json`, 14 events), so every Claude Code session appears
immediately. Then, in any Claude Code session:

```
/forge-plan a pomodoro web app
```

…and watch the board fill with a task pipeline that executes node by node —
wire in + verify — exactly the mission-control view from the video.

## The board (v3 — mission control)

- **Task pipeline** from Claude Code's native task system (TaskCreate/TaskUpdate +
  TaskCreated/TaskCompleted hooks): dense numbered nodes, status borders, duration
  badges, `[RULE] …` tasks as cyan ◇ nodes + one glowing **COMPLIANCE n/m** billboard,
  real `addBlockedBy` DAG edges — and the **circuit lights up green** along completed
  chains. Defaults to the newest run; `ALL` shows per-session swimlanes.
- **Run header**: run title derived from the `/forge-plan` goal, with a **▾ dropdown**
  to switch runs; **segmented progress bar** (one segment per task — click = jump to
  node); bare `HH:MM:SS` run timer; `LINE: FREE|BUSY|WAITING`; events/min sparkline.
- **NOW strip**: the active task + elapsed, updating live under the top bar.
- **SELECTED NODE**: click any node — status history, brief, dependencies, failures,
  and the tool events captured while it ran; `EXPORT ⬇` downloads a markdown run report.
- **LIVE LOG**: narrative feed (`→ TASK 07 — wire in …`, coalesced tool chatter,
  verb-colored accents) with search/filters/pause; `DETAIL` switches to raw events;
  click any row for full payload JSON.
- **REPLAY**: scrub the timeline rail to watch the run re-light from any buffered
  moment; `● LIVE` snaps back.
- **More**: `FOLLOW` (auto-scroll to the active node), board filters
  (`ALL·ACTIVE·FAILED·RULES`, dim-don't-hide), keyboard (`/` search · `f` follow ·
  arrows walk nodes · `Esc`), `STATS` (tool usage, failures, task durations),
  `FORGED` registry, `FX` toggle (CRT flavor; honors `prefers-reduced-motion`),
  boot splash (skippable).

## The skills

| Skill | What it does |
|---|---|
| `/forge-plan <goal>` | Decomposes the goal into 15–40 native tasks (+ `[RULE]` invariants), then executes node-by-node: in_progress → work → **verify by running it** → completed. The board lights up live. |
| `/forge-build <capability>` | Forges a new skill/subagent/hook automation: scaffolds correct frontmatter, validates (`hooks/validate_artifact.js`), registers (`hooks/register_capability.js`). |

Both live in `.claude/skills/` here and are installed user-wide in
`~/.claude/skills/` so they work from any project.

## How it works

```
any Claude Code session on this PC
  └─ 14 hooks (exec form → node.exe, no shell)          ~/.claude/settings.json
       └─ hooks/send_event.js     truncate → POST, silent, always exit 0
            └─ http://127.0.0.1:4000/events
                 server/server.js     ring buffer + data/events.jsonl (rotated >50MB)
                 ├─ GET /             the mission-control dashboard
                 ├─ GET /stream       Server-Sent Events (live)
                 └─ /api/events · /api/registry · /api/transcript · /api/health
```

Hooked events: SessionStart/End, UserPromptSubmit, Pre/PostToolUse,
PostToolUseFailure, Notification, PermissionRequest, SubagentStart/Stop, Stop,
PreCompact, **TaskCreated, TaskCompleted**. A hook adds ~50–100 ms; if the server
is down everything no-ops silently.

**Transport note:** the dashboard polls `GET /api/sync?after=<id>` once per second
(paged ≤80 events per response) instead of holding an SSE stream — some
network-inspection software (AV) buffers browsers' streaming response bodies
indefinitely and silently eats responses larger than ~250 KB, which kills
EventSource/fetch-streaming while small completed responses always pass.
`/stream` (SSE) remains for curl/tools, and `/probe` is a built-in transport
diagnostic page.

## Privacy & config

- Prompts/tool text truncated to ~1,200 chars per field; all storage is local
  (`data/events.jsonl`, `data/registry.json` — don't hand-edit the registry, use
  `register_capability.js`).
- Transcript viewer only reads files under `~/.claude`.
- Port: `FORGE_PORT=4001 node server\server.js` + set `FORGE_SERVER_URL` user-wide.
- Multiple dashboard tabs share the browser's 6-connection limit — close old tabs
  if one won't connect.
- Known limitation: cross-session shared task lists aren't merged; each session's
  tasks render in its own band.

## Uninstall / pause

Delete the `"hooks"` block from `~/.claude/settings.json` (takes effect
immediately — hooks hot-reload). Stop the server; delete `data/` to drop history.
