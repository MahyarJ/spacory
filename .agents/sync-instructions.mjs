// Claude skills are byte-identical compatibility copies of the canonical Markdown.
// Run with --check in tests; omit it after editing a canonical instruction file.
import { readFileSync, writeFileSync } from "node:fs";

export const instructionNames = [
  "product-agent",
  "engineer-agent",
  "spacory-conventions",
  "spacory-verify",
  "spacory-notify",
];

let stale = false;
for (const name of instructionNames) {
  const canonical = new URL(`./instructions/${name}.md`, import.meta.url);
  const claude = new URL(`../.claude/skills/${name}/SKILL.md`, import.meta.url);
  const content = readFileSync(canonical);
  if (process.argv.includes("--check")) {
    if (!content.equals(readFileSync(claude))) {
      console.error(`Stale Claude skill: ${name}; run npm run agents:sync`);
      stale = true;
    }
  } else {
    writeFileSync(claude, content);
  }
}
if (stale) process.exitCode = 1;
