import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

await Promise.all([
  // ffmpeg-static stays external: it locates its binary relative to its own folder
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', platform: 'node', format: 'cjs', external: ['electron', 'ffmpeg-static'] }),
  build({ ...common, entryPoints: ['src/cli/oru.ts'], outfile: 'dist/cli/oru.js', platform: 'node', format: 'cjs', external: ['ffmpeg-static'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/overlay.ts', 'src/renderer/settings.ts', 'src/renderer/create.ts'], outdir: 'dist/renderer', platform: 'browser', format: 'iife' }),
]);

mkdirSync('dist/renderer', { recursive: true });
for (const f of ['overlay.html', 'overlay.css', 'settings.html', 'settings.css', 'create.html', 'create.css']) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}
