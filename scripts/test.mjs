import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({
  entryPoints: ['tests/core.test.ts'],
  outfile: '.test/core.test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const result = spawnSync(process.execPath, ['--test', '.test/core.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status || 0;
