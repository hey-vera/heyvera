/**
 * sense — CLI for verifying Soma birth certificates.
 *
 * Usage:
 *   sense verify <cert.json> --pubkey <hex|base64> [--data <file>] [--source-pubkey <key>] [--max-age <seconds>]
 *   sense verify-chain <chain.json> --keys <keys.json>
 *
 * Exit codes:
 *   0 — certificate valid
 *   1 — certificate invalid
 *   2 — usage error
 */

import { readFileSync } from 'fs';
import { verifyBirthCert, verifyBirthCertChain, type BirthCertificate } from './index.js';

function die(msg: string, code = 2): never {
  process.stderr.write(`sense: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else if (!args._cmd) {
      args._cmd = a;
    } else if (!args._arg) {
      args._arg = a;
    }
  }
  return args;
}

function printUsage(): never {
  process.stdout.write(`sense — Soma birth-certificate verifier

Usage:
  sense verify <cert.json> --pubkey <key> [options]
  sense verify-chain <chain.json> --keys <keys.json>

Options:
  --pubkey <key>          Receiver heart public key (hex or base64)
  --source-pubkey <key>   Source heart public key (for dual-signed certs)
  --data <file>           Raw data file (for integrity check)
  --max-age <seconds>     Reject certs older than N seconds
  --json                  Output JSON verdict instead of human text

Exit codes:
  0 — valid   1 — invalid   2 — usage error
`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._cmd;
  if (!cmd || args.help) printUsage();

  if (cmd === 'verify') {
    const certPath = args._arg as string | undefined;
    if (!certPath) die('verify: cert.json path required');
    if (!args.pubkey) die('verify: --pubkey required');

    let cert: BirthCertificate;
    try {
      cert = JSON.parse(readFileSync(certPath, 'utf8'));
    } catch (err) {
      die(`verify: cannot read ${certPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const data = args.data ? readFileSync(args.data as string, 'utf8') : undefined;
    const maxAgeSeconds = args['max-age'] ? parseInt(args['max-age'] as string, 10) : undefined;

    const result = verifyBirthCert({
      cert,
      data,
      publicKey: args.pubkey as string,
      sourcePublicKey: args['source-pubkey'] as string | undefined,
      maxAgeSeconds,
    });

    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const verdict = result.valid ? '\x1b[32mVALID\x1b[0m' : '\x1b[31mINVALID\x1b[0m';
      process.stdout.write(`\nVerdict: ${verdict}\n`);
      process.stdout.write(`Trust tier: ${result.trustTier}\n`);
      process.stdout.write(`Age: ${result.ageSeconds}s\n\n`);
      process.stdout.write('Checks:\n');
      for (const c of result.checks) process.stdout.write(`  \x1b[32m✓\x1b[0m ${c}\n`);
      if (result.reasons.length > 0) {
        process.stdout.write('\nFailures:\n');
        for (const r of result.reasons) process.stdout.write(`  \x1b[31m✗\x1b[0m ${r}\n`);
      }
      process.stdout.write('\n');
    }
    process.exit(result.valid ? 0 : 1);
  }

  if (cmd === 'verify-chain') {
    const chainPath = args._arg as string | undefined;
    if (!chainPath) die('verify-chain: chain.json path required');
    if (!args.keys) die('verify-chain: --keys keys.json required');

    const chain = JSON.parse(readFileSync(chainPath, 'utf8')) as BirthCertificate[];
    const keysObj = JSON.parse(readFileSync(args.keys as string, 'utf8')) as Record<string, string>;
    const keys = new Map<string, string>(Object.entries(keysObj));

    const result = verifyBirthCertChain(chain, keys);
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const verdict = result.valid ? '\x1b[32mVALID\x1b[0m' : '\x1b[31mINVALID\x1b[0m';
      process.stdout.write(`\nChain verdict: ${verdict}\n`);
      process.stdout.write(`Length: ${chain.length}\n`);
      if (!result.valid) {
        process.stdout.write(`Broken at index: ${result.brokenAt}\n`);
        process.stdout.write(`Reason: ${result.reason}\n`);
      }
      process.stdout.write('\n');
    }
    process.exit(result.valid ? 0 : 1);
  }

  die(`unknown command: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(`sense: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
