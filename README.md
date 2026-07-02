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

## The board

- **Task nodes** come from Claude Code's native task system (TaskCreate/TaskUpdate +
  TaskCreated/TaskCompleted hooks) — any session that plans with tasks gets a live
  pipeline; `[RULE] …` subjects render as cyan ◇ compliance nodes and scroll in the
  ticker. Dependencies (`addBlockedBy`) draw the DAG edges.
- **Session chips**: one per session (identity color, ▸/◐/○ status, `done/total`
  tasks, `!` when an agent is blocked on you). Click = focus that session (board,
  LINE pill, timer, log). Double-click = full transcript viewer.
- **SELECTED NODE**: click any node — status history, description, dependencies,
  and the tool events that happened while it ran (attributed by time window).
- **LIVE LOG**: mono stream of every hook event, with search + session/app/type
  filters, pause, and click-row → full payload JSON.
- **Top bar**: `LINE: FREE|BUSY|WAITING` (is the agent idle / working / blocked on
  you), `● LIVE` (stream health), `T+HH:MM:SS` run timer, events/min sparkline,
  `AGENTS`, `FORGED` (click → registry), and `FX` (toggles the CRT flavor; honors
  `prefers-reduced-motion`).

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
