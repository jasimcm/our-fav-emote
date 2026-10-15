import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray, type Display } from 'electron';
import path from 'node:path';
import type { CharacterInfo, ReminderId, Settings } from '../shared/types';
import { handleScheme, listCharacters, loadCharacter, registerScheme, userCharactersDir } from './characters';
import { openCreator, registerCreatorIpc } from './creator/window';
import { startDevAids } from './dev';
import { watchFullscreen } from './fullscreen';
import { REMINDER_IDS, Reminders, todayStats } from './reminders';
import { loadSettings, saveSettings } from './settings';

registerScheme();
// the smoke test runs against its own throwaway data folder
if (process.env.ORU_SMOKE) app.setPath('userData', path.join(process.env.ORU_SMOKE, 'userData'));
if (!app.requestSingleInstanceLock()) app.exit(0);

const ROOT = app.getAppPath();
const PRELOAD = path.join(ROOT, 'dist', 'preload', 'preload.js');
const RENDERER = path.join(ROOT, 'dist', 'renderer');

let overlay: BrowserWindow;
let settingsWin: BrowserWindow | null = null;
let tray: Tray;
let settings: Settings;
let character: CharacterInfo | null = null;
let display: Display;
let manualPause = false;
let fullscreenPause = false;

const reminders = new Reminders(
  () => settings,
  () => character,
  (r) => overlay.webContents.send('remind', r),
);

// ---------- overlay window ----------
function createOverlay(): void {
  display = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...display.workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('oru://app/overlay.html');
}

/** Follow the cursor to whichever monitor it is on. */
function followCursorDisplay(): void {
  const moveTo = (d: Display) => {
    display = d;
    overlay.setBounds(d.workArea);
    overlay.webContents.send('bounds');
  };
  setInterval(() => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (d.id !== display.id) moveTo(d);
  }, 1500);
  // taskbar moved / resolution changed on the current display
  screen.on('display-metrics-changed', (_e, d) => d.id === display.id && moveTo(d));
  screen.on('display-removed', (_e, d) => d.id === display.id && moveTo(screen.getPrimaryDisplay()));
}

function applyPause(): void {
  const paused = manualPause || fullscreenPause;
  reminders.hold(paused);
  overlay.webContents.send('pause', paused);
  if (paused) overlay.hide();
  else overlay.showInactive();
  buildTray();
}

// ---------- character + settings ----------
function useCharacter(id: string): void {
  character = loadCharacter(id) ?? loadCharacter('placeholder');
  if (character) overlay.webContents.send('character', character);
}

function applySettings(next: Settings): void {
  const charChanged = next.character !== settings?.character;
  const remindersChanged = JSON.stringify(next.reminders) !== JSON.stringify(settings?.reminders);
  settings = next;
  saveSettings(settings);
  if (app.isPackaged || process.platform !== 'darwin') {
    app.setLoginItemSettings({ openAtLogin: settings.startOnLogin });
  }
  overlay.webContents.send('settings', settings);
  if (charChanged) useCharacter(settings.character);
  if (remindersChanged) reminders.start();
  buildTray();
}

// ---------- settings window ----------
function openSettings(): void {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 440,
    height: 820,
    resizable: false,
    title: 'Oru Companion Settings',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD },
  });
  settingsWin.loadURL('oru://app/settings.html');
  settingsWin.on('closed', () => (settingsWin = null));
}

// ---------- tray ----------
function buildTray(): void {
  if (!tray) {
    // macOS: monochrome template icon (auto light/dark, @2x picked up automatically)
    const icon = process.platform === 'darwin'
      ? nativeImage.createFromPath(path.join(ROOT, 'assets', 'trayTemplate.png'))
      : nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png')).resize({ width: 16, height: 16 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Oru Companion');
    tray.on('double-click', openSettings);
  }
  const paused = manualPause || fullscreenPause;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: manualPause ? 'Resume' : fullscreenPause ? 'Paused (fullscreen app)' : 'Pause',
        enabled: !(fullscreenPause && !manualPause),
        click: () => { manualPause = !manualPause; applyPause(); },
      },
      {
        label: 'Switch character',
        submenu: listCharacters().map((c) => ({
          label: c.name,
          type: 'radio' as const,
          checked: c.id === settings.character,
          click: () => applySettings({ ...settings, character: c.id }),
        })),
      },
      { label: 'Reminder settings…', click: openSettings },
      { label: 'Create a character from a photo…', click: () => openCreator(PRELOAD) },
      { label: 'Reload character', click: () => useCharacter(settings.character) },
      {
        label: 'Remind me now',
        enabled: !paused,
        submenu: REMINDER_IDS.map((id) => ({ label: id, click: () => reminders.trigger(id) })),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

// ---------- IPC ----------
function registerIpc(): void {
  ipcMain.on('ready', () => {
    overlay.webContents.send('settings', settings);
    if (character) overlay.webContents.send('character', character);
  });
  ipcMain.on('interactive', (_e, on: boolean) => overlay.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('answer', (_e, id: ReminderId, choice: 'yes' | 'later') => reminders.answer(id, choice));
  ipcMain.handle('cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    if (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) return null;
    return { x: p.x - b.x, y: p.y - b.y };
  });
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', (_e, s: Settings) => applySettings(s));
  ipcMain.handle('characters:list', () => listCharacters());
  ipcMain.handle('stats:today', () => todayStats());
  ipcMain.on('characters:open', () => shell.openPath(userCharactersDir()));
  ipcMain.on('reminder:test', (_e, id: ReminderId) => reminders.trigger(id));
  ipcMain.on('creator:open', () => openCreator(PRELOAD));
  registerCreatorIpc((id) => applySettings({ ...settings, character: id }));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  handleScheme(RENDERER);
  settings = loadSettings();
  character = loadCharacter(settings.character) ?? loadCharacter('placeholder');
  registerIpc();
  createOverlay();
  buildTray();
  reminders.start();
  followCursorDisplay();
  watchFullscreen((fs) => { fullscreenPause = fs; applyPause(); });
  startDevAids({ overlay: () => overlay, openSettings, settingsWin: () => settingsWin, reminders, applySettings, settings: () => settings });
});

app.on('window-all-closed', () => { /* keep running in the tray */ });
