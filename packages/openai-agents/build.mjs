import { build } from 'esbuild';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: ['openai'],
};

await Promise.all([
  build({ ...shared, format: 'cjs', outfile: 'dist/index.js' }),
  build({ ...shared, format: 'esm', outfile: 'dist/index.mjs' }),
]);

// Generate .d.ts via tsc
import { execSync } from 'child_process';
execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });

console.log('Build complete: dist/index.js, dist/index.mjs, dist/index.d.ts');
