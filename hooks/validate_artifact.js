#!/usr/bin/env node
/**
 * Forge artifact validator — catches the silent-load failures that make a
 * forged skill/agent register green on the dashboard but never actually load.
 *
 *   node hooks/validate_artifact.js <path to SKILL.md or .claude/agents/name.md>
 *
 * Checks: frontmatter parses (flat key: value), required keys, kebab-case
 * name, name matches directory/filename, trigger-quality description, body
 * present, no tabs/smart-quotes in frontmatter.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) { console.error("usage: node validate_artifact.js <path to .md>"); process.exit(1); }

const issues = [];
let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (err) {
  console.error(`FAIL: cannot read ${file} (${err.message})`);
  process.exit(1);
}

// --- frontmatter block
if (!text.startsWith("---")) issues.push("file must start with `---` frontmatter");
const end = text.indexOf("\n---", 3);
if (end === -1) issues.push("frontmatter is never closed with a `---` line");

const fm = {};
if (issues.length === 0) {
  const block = text.slice(text.indexOf("\n") + 1, end);
  if (/\t/.test(block)) issues.push("frontmatter contains tab characters — YAML requires spaces");
  if (/[“”‘’]/.test(block)) issues.push("frontmatter contains smart quotes — use straight quotes");
  for (const line of block.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) {
      if (/^\s+-\s/.test(line) || /^\s+\w/.test(line)) continue; // tolerate simple YAML lists/indents
      issues.push(`frontmatter line not parseable as \`key: value\`: "${line.trim().slice(0, 60)}"`);
      continue;
    }
    fm[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

// --- required keys
if (!fm.name) issues.push("missing `name:` in frontmatter");
if (!fm.description) issues.push("missing `description:` in frontmatter");

// --- name quality + location match
if (fm.name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(fm.name)) issues.push(`name "${fm.name}" must be kebab-case: ^[a-z0-9][a-z0-9-]*$`);
  const base = path.basename(file);
  const dir = path.basename(path.dirname(file));
  if (base.toUpperCase() === "SKILL.MD") {
    if (dir !== fm.name) issues.push(`skill directory "${dir}" must equal frontmatter name "${fm.name}" — the directory is the /command name`);
  } else if (base.toLowerCase().endsWith(".md")) {
    const stem = base.slice(0, -3);
    if (stem !== fm.name) issues.push(`agent filename "${stem}" must equal frontmatter name "${fm.name}"`);
  }
}

// --- description quality (what makes auto-invocation work)
if (fm.description) {
  if (fm.description.length < 20) issues.push("description too short to ever trigger — name the situations/phrases it should fire on");
  if (fm.description.length > 1536) issues.push(`description is ${fm.description.length} chars — limit is 1,536`);
}

// --- body
if (end !== -1 && text.slice(end + 4).trim().length < 40) {
  issues.push("body after frontmatter is (nearly) empty — there are no instructions to follow");
}

if (issues.length) {
  console.error(`FAIL — ${issues.length} issue${issues.length === 1 ? "" : "s"} in ${file}:`);
  issues.forEach((s, i) => console.error(`  ${i + 1}. ${s}`));
  process.exit(1);
}
console.log(`PASS — ${file} (name: ${fm.name})`);
