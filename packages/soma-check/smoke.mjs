// Smoke test: hit the live demo endpoint twice, expect 2nd call to be cached.
import { SomaCheckClient } from './dist/index.mjs';

const URL = 'http://localhost:3402/v1/soma/demo/crypto-prices';
const client = new SomaCheckClient();

console.log('Call 1 (cold)…');
const r1 = await client.fetch(URL);
console.log('  status:', r1.status, 'cached:', r1.somaCached, 'etag:', r1.headers.get('etag')?.slice(0, 24));

console.log('Call 2 (warm)…');
const r2 = await client.fetch(URL);
console.log('  status:', r2.status, 'cached:', r2.somaCached);

console.log('\nStats:', client.stats());
