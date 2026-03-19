import { build } from 'esbuild';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  minify: false,
  sourcemap: true,
};

// CJS build
await build({ ...shared, outfile: 'dist/index.js', format: 'cjs' });

// ESM build
await build({ ...shared, outfile: 'dist/index.mjs', format: 'esm' });

// Types - just copy the source for now (tsc would be better but adds complexity)
import { writeFileSync, readFileSync } from 'fs';
import { mkdirSync } from 'fs';
try { mkdirSync('dist', { recursive: true }); } catch {}

// Generate a basic .d.ts that re-exports from source
const src = readFileSync('src/index.ts', 'utf8');
// Extract all export lines for types
const typeLines = src.split('\n')
  .filter(l => l.startsWith('export '))
  .map(l => {
    // Convert export class/interface/type/function to declarations
    if (l.includes('export class ')) return l.replace(/\{.*$/, '{}');
    if (l.includes('export interface ')) return l;
    if (l.includes('export type ')) return l;
    return l;
  });
console.log('Built @clawnet/sdk: CJS + ESM');
