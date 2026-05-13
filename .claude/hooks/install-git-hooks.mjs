#!/usr/bin/env node
// install-git-hooks.mjs — installs a git pre-commit hook that enforces the quality gate
// Usage: node .claude/hooks/install-git-hooks.mjs

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '# dual-brain-orchestrator';

// Shell block that runs the quality gate. Embedded as a template literal so the
// actual newlines are preserved when written to disk.
const GATE_BLOCK = `
${MARKER} quality gate
GATE_RESULT=$(node .claude/hooks/quality-gate.mjs 2>/dev/null)
GATE_STATUS=$(echo "$GATE_RESULT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{console.log(JSON.parse(d).gate)}catch{console.log('error')}
  })
")

case "$GATE_STATUS" in
  pass|disabled)
    exit 0
    ;;
  issues_found)
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║  Quality Gate: ISSUES FOUND                      ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║  GPT review flagged issues in your changes.      ║"
    echo "║  Check .claude/reviews/ for details.             ║"
    echo "║                                                  ║"
    echo "║  To commit anyway: git commit --no-verify        ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    exit 1
    ;;
  needs_human_review)
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║  Quality Gate: NEEDS HUMAN REVIEW               ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║  GPT review unavailable. Review your diff        ║"
    echo "║  manually before committing.                     ║"
    echo "║                                                  ║"
    echo "║  To commit anyway: git commit --no-verify        ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    exit 1
    ;;
  *)
    echo "[Quality Gate] Warning: gate returned '$GATE_STATUS'"
    exit 0
    ;;
esac
`;

const FULL_SCRIPT = `#!/bin/sh
${GATE_BLOCK.trimStart()}`;

function getGitHooksDir() {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    return join(gitDir, 'hooks');
  } catch {
    console.error('Error: not inside a git repository (git rev-parse --git-dir failed).');
    process.exit(1);
  }
}

function main() {
  const hooksDir = getGitHooksDir();
  const hookPath = join(hooksDir, 'pre-commit');

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');

    if (existing.includes(MARKER)) {
      console.log(
        'Pre-commit hook already contains the dual-brain-orchestrator quality gate. Nothing to do.'
      );
      return;
    }

    // Append our block without overwriting the user's existing hook.
    console.log('Pre-commit hook already exists — appending quality gate block.');
    appendFileSync(hookPath, GATE_BLOCK, 'utf8');
  } else {
    writeFileSync(hookPath, FULL_SCRIPT, 'utf8');
  }

  chmodSync(hookPath, 0o755);

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    Git Pre-Commit Hook Installed                 ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║ Quality gate will run before every commit.       ║');
  console.log('║ Use --no-verify to bypass when needed.           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

main();
