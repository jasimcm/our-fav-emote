// Generates the placeholder character (VP9-with-alpha WebM clips + manifest) and app icons.
// Run: npm run placeholders   (uses the bundled ffmpeg-static)
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'characters', 'placeholder');

const writeDataUrl = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, 'placeholder', 'index.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  while (!(await js('!!window.placeholder'))) await new Promise((r) => setTimeout(r, 50));
  const meta = await js('({ names: placeholder.clipNames, speed: placeholder.WALK_SPEED })');

  fs.mkdirSync(OUT, { recursive: true });
  const clips = {};
  for (const name of meta.names) {
    const frames = await js(`placeholder.renderClip(${JSON.stringify(name)})`);
    const fps = await js(`placeholder.clipFps(${JSON.stringify(name)})`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `oru-${name}-`));
    frames.forEach((f, i) => writeDataUrl(path.join(tmp, `${String(i).padStart(4, '0')}.png`), f));
    const file = `${name}.webm`;
    execFileSync(ffmpeg, [
      '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(tmp, '%04d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1',
      '-auto-alt-ref', '0', path.join(OUT, file),
    ]);
    fs.rmSync(tmp, { recursive: true, force: true });
    clips[name] = file;
    console.log(`  ${file}  (${frames.length} frames @ ${fps}fps)`);
  }

  const manifest = {
    name: 'Placeholder',
    author: 'Oru Companion',
    height: 300,
    walkSpeed: meta.speed,
    clips,
    lines: {
      en: { water: { text: '{name}, time to drink some water! 💧', thanks: 'Good! Stay hydrated 😄' } },
      ml: { water: { text: '{name}, വെള്ളം കുടിക്കാൻ സമയമായി! 💧', thanks: 'അടിപൊളി! 😄' } },
    },
    voices: {},
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  writeDataUrl(path.join(ROOT, 'assets', 'tray.png'), await js('placeholder.renderIcon(32)'));
  writeDataUrl(path.join(ROOT, 'assets', 'icon.png'), await js('placeholder.renderIcon(512)'));
  writeDataUrl(path.join(ROOT, 'assets', 'trayTemplate.png'), await js('placeholder.renderTrayTemplate(16)'));
  writeDataUrl(path.join(ROOT, 'assets', 'trayTemplate@2x.png'), await js('placeholder.renderTrayTemplate(32)'));
  console.log(`Placeholder character written to ${path.relative(ROOT, OUT)} (walkSpeed ${meta.speed}px/s)`);
  app.quit();
});
