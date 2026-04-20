#!/usr/bin/env node

import { openBrowser } from './browser.js';
import { getRoster, promoteCredential, getPendingCeremonies, getCeremony } from './api.js';
import { printTable, printCeremony, printSuccess, printError } from './format.js';

const DASHBOARD_URL = process.env.SOMA_SIGN_DASHBOARD_URL ?? 'http://localhost:5173';
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`soma-sign — Soma release signing ceremony CLI

Commands:
  enroll              Enroll a WebAuthn credential (opens browser)
  authorize           Approve a pending ceremony (opens browser)
  status              Show pending ceremonies

  authn add           Add a new credential (opens browser)
  authn promote <id>  Promote credential to primary
  authn roster        List all credentials

Environment:
  CLAWNET_URL              API base URL (default: http://localhost:3402)
  SOMA_SIGN_DASHBOARD_URL  Dashboard URL (default: http://localhost:5173)`);
}

async function cmdEnroll(): Promise<void> {
  const url = `${DASHBOARD_URL}/#enroll`;
  console.log('Opening enrollment page in browser...');
  openBrowser(url);
  console.log('Complete WebAuthn enrollment in your browser.');
}

async function cmdAuthorize(): Promise<void> {
  let ceremonies;
  try {
    ceremonies = await getPendingCeremonies();
  } catch (err) {
    printError(`Failed to fetch ceremonies: ${(err as Error).message}`);
    process.exit(1);
  }

  if (ceremonies.length === 0) {
    console.log('No pending ceremonies.');
    return;
  }

  const ceremony = ceremonies[0];
  printCeremony(ceremony as unknown as Record<string, unknown>);
  console.log('');

  if (ceremonies.length > 1) {
    console.log(`(${ceremonies.length - 1} more pending — using latest)\n`);
  }

  const url = `${DASHBOARD_URL}/#ceremony/${ceremony.id}`;
  console.log('Opening ceremony approval page in browser...');
  openBrowser(url);
  console.log('Complete WebAuthn authentication in your browser.\n');

  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const updated = await getCeremony(ceremony.id);
      if (updated.status === 'completed') {
        printSuccess(`Ceremony ${ceremony.id} completed — ${ceremony.package} v${ceremony.targetVersion} signed.`);
        return;
      }
      if (updated.status === 'expired') {
        printError(`Ceremony ${ceremony.id} expired.`);
        process.exit(1);
      }
    } catch (err) {
      printError(`Poll error: ${(err as Error).message}`);
    }
  }

  printError('Timed out waiting for ceremony completion (10 minutes).');
  process.exit(1);
}

async function cmdStatus(): Promise<void> {
  let ceremonies;
  try {
    ceremonies = await getPendingCeremonies();
  } catch (err) {
    printError(`Failed to fetch ceremonies: ${(err as Error).message}`);
    process.exit(1);
  }

  if (ceremonies.length === 0) {
    console.log('No pending ceremonies.');
    return;
  }

  printTable(
    ['ID', 'Package', 'Version', 'Status', 'Expires'],
    ceremonies.map(c => [c.id, c.package, c.targetVersion, c.status, c.expires_at])
  );
}

async function cmdAuthnRoster(): Promise<void> {
  let credentials;
  try {
    credentials = await getRoster();
  } catch (err) {
    printError(`Failed to fetch roster: ${(err as Error).message}`);
    process.exit(1);
  }

  if (credentials.length === 0) {
    console.log('No credentials enrolled.');
    return;
  }

  printTable(
    ['Ecosystem', 'Role', 'Status', 'Credential ID', 'Created', 'Last Used'],
    credentials.map(c => [
      c.ecosystem,
      c.role,
      c.status,
      c.credential_id,
      c.created_at,
      c.last_used_at ?? 'never',
    ])
  );
}

async function cmdAuthnAdd(): Promise<void> {
  const url = `${DASHBOARD_URL}/#enroll`;
  console.log('Opening credential enrollment page in browser...');
  openBrowser(url);
  console.log('Complete WebAuthn enrollment in your browser.');
}

async function cmdAuthnPromote(id: string): Promise<void> {
  try {
    await promoteCredential(id);
    printSuccess(`Credential ${id} promoted to primary.`);
  } catch (err) {
    printError(`Failed to promote credential: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log('\nUpdated roster:');
  await cmdAuthnRoster();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (command === 'enroll') {
    await cmdEnroll();
  } else if (command === 'authorize') {
    await cmdAuthorize();
  } else if (command === 'status') {
    await cmdStatus();
  } else if (command === 'authn') {
    if (subcommand === 'roster') {
      await cmdAuthnRoster();
    } else if (subcommand === 'add') {
      await cmdAuthnAdd();
    } else if (subcommand === 'promote') {
      const credentialId = args[2];
      if (!credentialId) {
        printError('Usage: soma-sign authn promote <credential-id>');
        process.exit(1);
      }
      await cmdAuthnPromote(credentialId);
    } else {
      printError(`Unknown authn subcommand: ${subcommand ?? '(none)'}`);
      printHelp();
      process.exit(1);
    }
  } else if (command === 'help' || command === '--help' || command === '-h' || !command) {
    printHelp();
  } else {
    printError(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

main();
