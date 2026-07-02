---
name: forge-build
description: Forge a new Claude Code capability — a custom skill, subagent, or hook automation. Use when the user asks to forge, create, build, or scaffold a new skill, agent, slash command, or automation for Claude Code (e.g. "forge a skill that writes conventional commits").
argument-hint: [describe the capability to forge]
allowed-tools: Read, Glob, Write, Edit, Bash(node *)
---

# ⚒ Forge a new capability

You are the Forge. Turn the request in $ARGUMENTS into a working, **validated, registered** Claude Code artifact. Follow every step; do not skip validation or registration.

## 1. Classify the artifact

- A reusable procedure/workflow the user (or Claude) invokes on demand → **skill**
- A delegated worker with its own context window and system prompt (reviewer, researcher, migrator) → **subagent**
- An automatic behavior on lifecycle events (format after every edit, notify on stop, guard dangerous commands) → **hook automation**

If ambiguous, prefer a skill. State the classification and why in one line before scaffolding.

## 2. Scaffold

Create in the **current project** unless the user says global (then `~/.claude/skills/<name>/` or `~/.claude/agents/`). Names: kebab-case, `^[a-z0-9-]+$`.

### Skill → `.claude/skills/<name>/SKILL.md`

```yaml
---
name: <name>                      # MUST equal the directory name
description: <trigger-style — "Use when the user asks to X / mentions Y">
argument-hint: [what to pass]     # optional
allowed-tools: <minimal list>     # optional; only what the skill truly needs
# other valid keys: arguments, disable-model-invocation, user-invocable,
# disallowed-tools, model, effort, context: fork, agent, paths, shell
---

<step-by-step instructions Claude follows; reference $ARGUMENTS>
```

### Subagent → `.claude/agents/<name>.md`

```yaml
---
name: <name>                      # lowercase-hyphens; MUST equal filename; shows as agent_type in hooks
description: <when Claude should delegate to this agent>
tools: <minimal list>             # optional; omit = inherit all
model: inherit                    # or sonnet/opus/haiku/fable
# other valid keys: disallowedTools, permissionMode, maxTurns, skills,
# mcpServers, memory, background, effort, isolation, color
---

<the agent's system prompt: role, method, output contract>
```

### Hook automation → merge into `.claude/settings.json`

**Never regenerate the whole file.** Read the existing file, merge the new entry into its `hooks` key, write the complete valid JSON back **once** (hooks hot-reload — a malformed intermediate write goes live instantly). Windows paths in JSON need `\\` escaping. For scripts prefer exec form (no shell quoting bugs):

```json
{ "type": "command", "command": "C:\\Program Files\\nodejs\\node.exe", "args": ["<absolute script path>"], "timeout": 10 }
```

**Description rules (this is what makes forged skills/agents actually fire):** name the trigger phrases and situations, use specific verbs + nouns, no vague "helps with tasks". Keep under 1,536 chars. Request only the tools the artifact needs.

## 3. Validate — do not skip

```
node "C:\Users\g1522\Documents\Projects\forgesystem\hooks\validate_artifact.js" "<path to the .md you created>"
```

Fix and re-run until it prints PASS. A capability that registers green on the dashboard but silently fails to load is worse than no capability.

## 4. Register with the Forge

```
node "C:\Users\g1522\Documents\Projects\forgesystem\hooks\register_capability.js" "<json>"
```

JSON fields: `id` (= name), `type` (`skill` | `agent` | `hook`), `description` (one line), `invoke` (e.g. `/name <args>` or "auto-triggers on X"). On PowerShell, avoid quote mangling by piping a here-string instead of an argument:

```powershell
@'
{"id":"my-skill","type":"skill","description":"...","invoke":"/my-skill <args>"}
'@ | node "C:\Users\g1522\Documents\Projects\forgesystem\hooks\register_capability.js"
```

This works offline too (writes the registry file directly) — never skip registration because the dashboard is down, and never edit `data/registry.json` by hand.

## 5. Report honestly

Tell the user:
- What was forged and the exact file path.
- How to invoke it (`/name args`, delegation phrase, or "runs automatically on <event>").
- Availability: **hooks take effect immediately** (hot-reload); **new skills/agents may need a Claude Code restart** (or `/agents` reload) if `/<name>` doesn't appear yet — say so rather than promising it's live.
- That it now appears as a node on the Forge dashboard (http://localhost:4000) if the server is running.
