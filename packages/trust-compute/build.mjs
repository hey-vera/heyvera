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

console.log('Built @aidprotocol/trust-compute: CJS + ESM');
