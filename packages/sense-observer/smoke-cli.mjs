// CLI smoke test — generates a real cert, writes it to disk, invokes the CLI.
import nacl from 'tweetnacl';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const keyPair = nacl.sign.keyPair();
const pubKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
const { createBirthCertificate } = await import('../../node_modules/soma-heart/dist/heart/birth-certificate.js');

const data = JSON.stringify({ hello: 'cli' });
const cert = createBirthCertificate(
  data,
  { type: 'api', identifier: 'https://cli.example', heartVerified: false },
  'did:soma:cli-heart',
  'session-cli',
  keyPair,
);

const dir = mkdtempSync(join(tmpdir(), 'sense-cli-'));
const certPath = join(dir, 'cert.json');
const dataPath = join(dir, 'data.txt');
writeFileSync(certPath, JSON.stringify(cert, null, 2));
writeFileSync(dataPath, data);

// Good verification
const goodOut = execSync(`node dist/cli.js verify "${certPath}" --pubkey ${pubKeyHex} --data "${dataPath}" --json`, { encoding: 'utf8' });
const good = JSON.parse(goodOut);
if (!good.valid) { console.error('FAIL: CLI good verify was invalid', good); process.exit(1); }
console.log('CLI good verify: VALID');

// Tamper data and re-verify
writeFileSync(dataPath, data + 'tampered');
try {
  execSync(`node dist/cli.js verify "${certPath}" --pubkey ${pubKeyHex} --data "${dataPath}" --json`, { encoding: 'utf8' });
  console.error('FAIL: CLI tampered verify did not exit non-zero');
  process.exit(1);
} catch (err) {
  // Exit code 1 expected
  if (err.status !== 1) { console.error('FAIL: expected exit 1, got', err.status); process.exit(1); }
  const tampered = JSON.parse(err.stdout);
  if (tampered.valid) { console.error('FAIL: tampered verify returned valid'); process.exit(1); }
  console.log('CLI tampered verify: INVALID (as expected)');
}

// Help
const help = execSync(`node dist/cli.js --help 2>&1 || true`, { encoding: 'utf8' });
if (!help.includes('sense —')) { console.error('FAIL: help output missing'); process.exit(1); }
console.log('CLI help: OK');

console.log('\nAll CLI smoke checks passed.');
