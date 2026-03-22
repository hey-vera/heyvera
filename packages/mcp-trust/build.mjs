import { build } from 'esbuild';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  minify: false,
  sourcemap: true,
  external: ['@aidprotocol/trust-compute'],
};

await build({ ...shared, outfile: 'dist/index.js', format: 'cjs' });
await build({ ...shared, outfile: 'dist/index.mjs', format: 'esm' });

console.log('Built @aidprotocol/mcp-trust: CJS + ESM');
