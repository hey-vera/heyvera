import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: false,
  sourcemap: true,
  external: ['@aidprotocol/trust-compute'],
  banner: { js: '#!/usr/bin/env node' },
});

console.log('Built @aidprotocol/facilitator');
