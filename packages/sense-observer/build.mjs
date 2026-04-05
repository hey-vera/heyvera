import { build } from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync, chmodSync } from 'fs';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  minify: false,
  sourcemap: true,
  external: ['tweetnacl'],
};

try { mkdirSync('dist', { recursive: true }); } catch {}

// Library: CJS + ESM
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', format: 'cjs' });
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs', format: 'esm' });

// CLI binary — CJS with shebang
await build({
  ...shared,
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
});
try { chmodSync('dist/cli.js', 0o755); } catch {}

// Types
try {
  execSync('npx tsc --project tsconfig.json --emitDeclarationOnly', { stdio: 'inherit' });
} catch (err) {
  console.warn('tsc type generation failed:', err.message);
}

console.log('Built @clawnet/sense-observer: CJS + ESM + CLI + .d.ts');
