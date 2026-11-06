import { build } from 'esbuild';
await build({
  entryPoints: ['src/worker.ts'],
  outfile: 'dist/worker.js',
  bundle: true,
  format: 'esm',
  target: 'chrome138',
  minify: false,
});
