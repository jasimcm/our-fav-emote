import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { CreatorBuildRequest, CreatorBuildResult, CreatorPhoto } from '../../shared/types';
import { userCharactersDir } from '../characters';
import { createCharacter } from './create';
import { preparePhoto } from './photo';
import { RECIPES } from './recipes';
import { creatorSupported } from './tools';

let win: BrowserWindow | null = null;
let prepared: string | null = null; // last prepared image on disk

const slug = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';

function uniqueId(name: string): string {
  const base = slug(name);
  let id = base;
  for (let i = 2; fs.existsSync(path.join(userCharactersDir(), id)); i++) id = `${base}-${i}`;
  return id;
}

export function openCreator(preload: string): void {
  if (win) return win.focus();
  win = new BrowserWindow({
    width: 600,
    height: 820,
    title: 'Create a character',
    autoHideMenuBar: true,
    webPreferences: { preload },
  });
  win.loadURL('oru://app/create.html');
  win.on('closed', () => (win = null));
}

/** `useCharacter` switches the companion to the new character. */
export function registerCreatorIpc(useCharacter: (id: string) => void): void {
  const workDir = path.join(app.getPath('userData'), 'creator');

  ipcMain.handle('creator:info', () => ({
    supported: creatorSupported(),
    recipes: RECIPES.map(({ id, title, makes, prompt }) => ({ id, title, makes, prompt })),
  }));

  ipcMain.handle('creator:pick', async (_e, kind: 'photo' | 'video') => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: kind === 'photo'
        ? [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff'] }]
        : [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('creator:preparePhoto', async (_e, src: string): Promise<CreatorPhoto> => {
    fs.mkdirSync(workDir, { recursive: true });
    const out = path.join(workDir, 'for-gemini.png');
    const r = await preparePhoto(src, out, {
      // ORU_MODELS_DIR lets tests/CI reuse one downloaded model
      modelsDir: process.env.ORU_MODELS_DIR || path.join(app.getPath('userData'), 'models'),
      progress: (m) => _e.sender.send('creator:log', m),
    });
    prepared = out;
    return {
      preview: `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`,
      backdrop: r.backdrop,
      warnings: r.warnings,
    };
  });

  ipcMain.handle('creator:saveImage', async (_e, name: string) => {
    if (!prepared) return null;
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('downloads'), `${slug(name)}-for-gemini.png`),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(prepared, r.filePath);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });

  ipcMain.on('creator:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.on('creator:openGemini', () => shell.openExternal('https://gemini.google.com/app'));

  ipcMain.handle('creator:build', async (e, req: CreatorBuildRequest): Promise<CreatorBuildResult> => {
    const id = uniqueId(req.name);
    const dir = path.join(userCharactersDir(), id);
    const log = (m: string) => e.sender.send('creator:log', m);
    try {
      const r = await createCharacter({ id, name: req.name, dir, videos: req.videos, log });
      if (prepared) fs.copyFileSync(prepared, path.join(dir, 'photo-for-gemini.png'));
      return { ok: true, id, clips: r.clips, warnings: r.warnings };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.on('creator:use', (_e, id: string) => useCharacter(id));
}
