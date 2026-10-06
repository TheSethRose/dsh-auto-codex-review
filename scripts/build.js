import { build } from 'esbuild';
await build({ entryPoints: ['src/index.js'], outfile: 'lib/index.js', bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', sourcemap: true });
