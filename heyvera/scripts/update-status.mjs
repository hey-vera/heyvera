import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const packet = process.argv[2];
const ready = process.argv[3] ?? "yes";

if (!packet) {
  console.error('Usage: npm run status:update -- "Packet N" [yes|no]');
  process.exit(1);
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const repoRoot = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
const webDir = path.join(repoRoot, "web");
const statusDir = path.join(webDir, "frontend-sync");
const statusPath = path.join(statusDir, "STATUS.md");

mkdirSync(statusDir, { recursive: true });

const branch = run("git", ["branch", "--show-current"], repoRoot);
const head = run("git", ["rev-parse", "HEAD"], repoRoot);

const content = `# Frontend Status

## Current Packet

- Active: ${packet}
- Branch: ${branch}
- Last Pushed Commit: ${head}
- Ready for Review: ${ready}

## Notes

- Updated automatically by \`npm run status:update\`.
`;

writeFileSync(statusPath, content, "utf8");
console.log(`Updated ${statusPath}`);
