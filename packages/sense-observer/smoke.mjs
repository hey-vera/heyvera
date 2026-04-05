// Smoke test — round-trips a birth cert from soma-heart through sense-observer.
// Uses the real soma-heart package to sign, then verifies from the outside.
import nacl from 'tweetnacl';
import { verifyBirthCert } from './dist/index.mjs';

// Generate a keypair the way a heart would
const keyPair = nacl.sign.keyPair();
const pubKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

// Import soma-heart from parent node_modules
const { createBirthCertificate } = await import('../../node_modules/soma-heart/dist/heart/birth-certificate.js');

const data = JSON.stringify({ hello: 'world', n: 42 });
const cert = createBirthCertificate(
  data,
  { type: 'api', identifier: 'https://test.example', heartVerified: false },
  'did:soma:test-heart',
  'session-smoke-1',
  keyPair,
);

console.log('\n=== Birth cert ===');
console.log(JSON.stringify(cert, null, 2));

// Verify with the correct key + correct data
const good = verifyBirthCert({ cert, data, publicKey: pubKeyHex });
console.log('\n=== Verify (good) ===');
console.log('valid:', good.valid);
console.log('checks:', good.checks);
console.log('reasons:', good.reasons);

// Verify with tampered data
const bad = verifyBirthCert({ cert, data: data + 'X', publicKey: pubKeyHex });
console.log('\n=== Verify (tampered data) ===');
console.log('valid:', bad.valid);
console.log('reasons:', bad.reasons);

// Verify with wrong key
const wrongKey = nacl.sign.keyPair();
const wrongKeyHex = Buffer.from(wrongKey.publicKey).toString('hex');
const badKey = verifyBirthCert({ cert, data, publicKey: wrongKeyHex });
console.log('\n=== Verify (wrong key) ===');
console.log('valid:', badKey.valid);
console.log('reasons:', badKey.reasons);

// Fail if any expected outcome is wrong
let fails = 0;
if (!good.valid) { console.error('FAIL: good cert did not verify'); fails++; }
if (bad.valid) { console.error('FAIL: tampered cert verified'); fails++; }
if (badKey.valid) { console.error('FAIL: wrong-key cert verified'); fails++; }
if (fails > 0) process.exit(1);
console.log('\nAll smoke checks passed.');
