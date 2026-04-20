const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );

  const separator = widths.map(w => '-'.repeat(w + 2)).join('+');
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `).join('|');

  console.log(`${BOLD}${formatRow(headers)}${RESET}`);
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

export function printCeremony(ceremony: Record<string, unknown>): void {
  console.log(`${BOLD}Ceremony ${ceremony.id}${RESET}`);
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
  console.log(`  Package:  ${ceremony.package} v${ceremony.targetVersion}`);
  console.log(`  SHA-256:  ${ceremony.tarballSha256}`);
  console.log(`  Commit:   ${ceremony.gitCommit}`);
  console.log(`  Status:   ${ceremony.status}`);
  console.log(`  Expires:  ${ceremony.expires_at}`);
}

export function printSuccess(message: string): void {
  console.log(`${GREEN}\u2714 ${message}${RESET}`);
}

export function printError(message: string): void {
  console.log(`${RED}\u2718 ${message}${RESET}`);
}
