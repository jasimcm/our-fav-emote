import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { todayStats, type Reminders } from './reminders';

interface Ctx {
  overlay: () => BrowserWindow;
  settingsWin: () => BrowserWindow | null;
  openSettings: () => void;
  reminders: Reminders;
  settings: () => Settings;
  applySettings: (s: Settings) => void;
}

/**
 * Development aids, all off unless their env var is set:
 *   ORU_DEBUG=1           print overlay console messages
 *   ORU_SMOKE=<dir>       run a scripted smoke test with its own data folder in <dir>,
 *                         save window captures there, then quit
 */
export function startDevAids(ctx: Ctx): void {
  const overlay = ctx.overlay();
  if (process.env.ORU_DEBUG || process.env.ORU_SMOKE) {
    overlay.webContents.on('console-message', (e) => console.log('[overlay]', e.message));
  }
  if (process.env.ORU_SMOKE) smoke(ctx, process.env.ORU_SMOKE).catch((e) => {
    console.error('[smoke] FAILED', e);
    app.exit(1);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function smoke(ctx: Ctx, outDir: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const overlay = ctx.overlay();
  const js = <T = unknown>(code: string) => overlay.webContents.executeJavaScript(code) as Promise<T>;
  const shot = async (win: BrowserWindow, name: string) => {
    fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`[smoke] captured ${name}.png`);
  };
  const clip = () => js<string>(`document.getElementById('clip').dataset.clip`);

  const state = () => js<{ hidden: boolean; clip: string; x: number; w: number }>(
    `(() => { const c = document.getElementById('char'); const v = document.getElementById('clip');
      const tx = parseFloat(c.style.transform.slice('translate('.length));
      return { hidden: c.hidden, clip: v.dataset.clip, x: tx + v.offsetWidth / 2, w: innerWidth }; })()`);
  const waitFor = async (what: string, ok: () => Promise<boolean>, ms = 40000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(250)) if (await ok()) return;
    throw new Error(`timed out waiting for: ${what}`);
  };

  // ---- visit mode (default): greeting visit walks in from the left, waves, walks off to the right
  await wait(1500);
  const enter = await state();
  console.log(`[smoke] visit: greeting clip ${enter.clip}, x ${Math.round(enter.x)} of ${enter.w}`);
  await waitFor('greeting visit to end', async () => (await state()).hidden);
  console.log('[smoke] visit: left the screen after greeting');

  ctx.reminders.trigger('stretch');
  await wait(1200);
  const arriving = await state();
  console.log(`[smoke] visit: reminder -> ${arriving.clip} at x ${Math.round(arriving.x)} (walking in from the ${arriving.x < arriving.w / 2 ? 'left' : 'right'})`);
  await shot(overlay, '0a-visit-arriving');
  await waitFor('arrival at the centre', async () => !(await state()).clip.startsWith('walk'));
  const asking = await state();
  console.log(`[smoke] visit: asking at x ${Math.round(asking.x)} of ${asking.w} (centre ${asking.w / 2})`);
  await wait(600);
  await shot(overlay, '0b-visit-asking');
  await js(`document.getElementById('btn-yes').click()`);
  let lastX = asking.x;
  await waitFor('walking off after Yes', async () => { const st = await state(); if (!st.hidden) lastX = st.x; return st.hidden; });
  console.log(`[smoke] visit: left via the ${lastX > asking.w / 2 ? 'right' : 'left'} side`);

  // ---- wander mode for the rest of the checks
  ctx.applySettings({ ...ctx.settings(), behaviour: 'wander' });
  await waitFor('walking back in', async () => !(await state()).hidden && !(await state()).clip.startsWith('walk'));
  console.log('[smoke] wander: back on screen, clip', await clip());

  ctx.applySettings({ ...ctx.settings(), name: 'Sam', lang: 'en' });
  ctx.reminders.trigger('water');
  await wait(900);
  console.log('[smoke] reminder clip:', await clip());
  await shot(overlay, '1-reminder-en');

  const before = todayStats().water ?? 0;
  await js(`document.getElementById('btn-yes').click()`);
  await wait(1200);
  console.log('[smoke] after Yes clip:', await clip());
  await shot(overlay, '2-drinking');
  console.log(`[smoke] water logged: ${before} -> ${todayStats().water ?? 0}`);

  ctx.applySettings({ ...ctx.settings(), lang: 'ml', scale: 1.3 });
  await wait(6000); // answer() waits 5s before showing the next reminder
  ctx.reminders.trigger('push');
  await wait(1200);
  await shot(overlay, '3-reminder-ml-scaled');
  await js(`document.getElementById('btn-later').click()`);
  await wait(800);
  await shot(overlay, '4-snoozed');

  ctx.openSettings();
  await wait(1500);
  const sw = ctx.settingsWin();
  if (sw) await shot(sw, '5-settings');

  // character creator: prepare a photo and build a character from stand-in videos
  const src = process.env.ORU_SMOKE_CREATOR;
  if (src) {
    ipcMain.emit('creator:open');
    await wait(1500);
    const cw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('create.html'))!;
    const cjs = <T = unknown>(code: string) => cw.webContents.executeJavaScript(code) as Promise<T>;
    await shot(cw, '6-creator');
    const photo = await cjs<{ backdrop: string; warnings: string[] }>(`oru.creator.preparePhoto(${JSON.stringify(path.join(src, 'photo.jpg'))})`);
    console.log(`[smoke] creator photo backdrop: ${photo.backdrop}, warnings: ${photo.warnings.length}`);
    const r = await cjs<{ ok: boolean; id?: string; clips?: string[]; error?: string }>(
      `oru.creator.build({ name: 'Smoke Test', videos: { hello: ${JSON.stringify(path.join(src, 'hello.mp4'))}, walk: ${JSON.stringify(path.join(src, 'walk.mp4'))} } })`,
    );
    if (!r.ok) throw new Error(`creator build failed: ${r.error}`);
    console.log(`[smoke] creator built ${r.id}: ${r.clips!.join(', ')}`);
    const served = await cjs<number>(`fetch('oru://app/char/${r.id}/idle.webm').then((x) => x.status)`);
    console.log(`[smoke] creator idle clip served: ${served}`);
    ipcMain.emit('creator:use', {}, r.id);
    await wait(2500);
    console.log('[smoke] overlay clip with new character:', await clip());
    await shot(overlay, '7-new-character');
  }

  console.log('[smoke] OK');
  await wait(300);
  app.quit();
}
