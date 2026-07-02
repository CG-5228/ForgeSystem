---
name: forge-plan
description: Run a Forge build — decompose a goal into a live task pipeline on the Forge board, then execute it node by node with wire-in + verify discipline. Use when the user asks to forge-plan something, run a forge build, or wants a goal turned into a task board and built end to end (e.g. "forge-plan a pomodoro web app").
argument-hint: [the goal to build]
---

# ⚒ Forge a build run

Turn the goal in $ARGUMENTS into a **live task pipeline** on the Forge board (http://localhost:4000) and execute it. Every step below is load-bearing: the board's nodes, ticker, LINE pill, and inspector are driven by your TaskCreate/TaskUpdate calls.

## 1. Understand + register the run

Restate the goal in one line. Decide where the work lives (the current project, or the scratchpad if it's a throwaway demo). Only ask the user something if the goal is genuinely ambiguous.

Register the run NOW (not at the end — the board's run title reads from this):

```
node "C:\Users\g1522\Documents\Projects\forgesystem\hooks\register_capability.js" "<json>"
```

with `{"id":"plan-<short-slug>","type":"plan","description":"<goal, one line>","invoke":"artifacts: <where the output will live>"}`. Works offline; never skip.

## 2. Plan as nodes

Create **15–40 tasks** with TaskCreate, in phase order — the creation order IS the board layout:

- Phases: **scaffold → build → wire → polish** (roughly; use what fits the goal).
- Subjects: imperative, **≤60 chars**, front-load the keyword (they render on ~150px nodes): `Scaffold index.html shell`, `Wire timer to start button`, not "We should probably…".
- Put the real detail in `description` (the board inspector shows it).
- Link REAL dependencies with `TaskUpdate {taskId, addBlockedBy:[…]}` — each phase's first task blocked by the previous phase's last, plus any true cross-deps. These draw the DAG edges. Don't fabricate deps that don't exist.

## 3. Compliance rules

Create **3–8 rule tasks** — subjects prefixed **`[RULE] `** — the invariants the build must satisfy, e.g. `[RULE] Every button has a hover state`, `[RULE] Works offline — no CDN imports`, `[RULE] No console errors`. They render as cyan ◇ compliance nodes and scroll in the board's ticker.

## 4. Execute — wire in + verify, node by node

Work tasks **in id order, one at a time**:

1. `TaskUpdate {taskId, status:"in_progress"}` — the node goes cyan; the board attributes your tool activity to it.
2. Do the work.
3. **Verify by exercising it** — run the code, load the page, observe the behavior. Never mark on faith.
4. `TaskUpdate {taskId, status:"completed"}` — the node goes green.

Keep exactly **one task in_progress at a time** (the board's LINE pill and event attribution depend on it). If you discover new work mid-run, TaskCreate it (it appends to the board) rather than silently expanding the current node.

## 5. Rules last

Verify each `[RULE]` task the same way — actually check the invariant, then complete it. A rule that FAILS stays in_progress and you create a fix task, wire it `addBlockedBy` nothing, fix, verify both. Never green a failing rule.

## 6. Report

Tell the user: what was built and where, the verify results (including any failed rules, honestly), and that the run is on the board at http://localhost:4000 — click any node for its history and related events.
