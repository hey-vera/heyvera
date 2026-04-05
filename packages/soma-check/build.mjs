import { build } from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  sourcemap: true,
};

try { mkdirSync('dist', { recursive: true }); } catch {}

// CJS build
await build({ ...shared, outfile: 'dist/index.js', format: 'cjs' });

// ESM build
await build({ ...shared, outfile: 'dist/index.mjs', format: 'esm' });

// Types — use tsconfig.json for project settings
try {
  execSync('npx tsc --project tsconfig.json --emitDeclarationOnly', { stdio: 'inherit' });
} catch (err) {
  console.warn('tsc type generation failed:', err.message);
}

console.log('Built @clawnet/soma-check: CJS + ESM + .d.ts');
