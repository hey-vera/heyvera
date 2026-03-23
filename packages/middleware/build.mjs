import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  minify: false,
  sourcemap: true,
  external: ['@aidprotocol/trust-compute'],
};

// Core (framework-agnostic)
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', format: 'cjs' });
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs', format: 'esm' });

// Express adapter
await build({ ...shared, entryPoints: ['src/express.ts'], outfile: 'dist/express.js', format: 'cjs' });
await build({ ...shared, entryPoints: ['src/express.ts'], outfile: 'dist/express.mjs', format: 'esm' });

// Fastify adapter
await build({ ...shared, entryPoints: ['src/fastify.ts'], outfile: 'dist/fastify.js', format: 'cjs' });
await build({ ...shared, entryPoints: ['src/fastify.ts'], outfile: 'dist/fastify.mjs', format: 'esm' });

console.log('Built @aidprotocol/middleware: core + express + fastify (CJS + ESM)');
