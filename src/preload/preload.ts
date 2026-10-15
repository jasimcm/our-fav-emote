import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OruApi } from '../shared/types';

const on = (channel: string) => (fn: (...a: any[]) => void) => {
  ipcRenderer.on(channel, (_e, ...args) => fn(...args));
};

const api: OruApi = {
  onCharacter: on('character'),
  onSettings: on('settings'),
  onRemind: on('remind'),
  onPause: on('pause'),
  onBounds: on('bounds'),
  ready: () => ipcRenderer.send('ready'),
  setInteractive: (v) => ipcRenderer.send('interactive', v),
  answer: (id, choice) => ipcRenderer.send('answer', id, choice),
  cursor: () => ipcRenderer.invoke('cursor'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  listCharacters: () => ipcRenderer.invoke('characters:list'),
  todayStats: () => ipcRenderer.invoke('stats:today'),
  openCharactersFolder: () => ipcRenderer.send('characters:open'),
  testReminder: (id) => ipcRenderer.send('reminder:test', id),
  openCreator: () => ipcRenderer.send('creator:open'),
  creator: {
    info: () => ipcRenderer.invoke('creator:info'),
    pick: (kind) => ipcRenderer.invoke('creator:pick', kind),
    pathForFile: (file) => webUtils.getPathForFile(file),
    preparePhoto: (src) => ipcRenderer.invoke('creator:preparePhoto', src),
    saveImage: (name) => ipcRenderer.invoke('creator:saveImage', name),
    copy: (text) => ipcRenderer.send('creator:copy', text),
    openGemini: () => ipcRenderer.send('creator:openGemini'),
    build: (req) => ipcRenderer.invoke('creator:build', req),
    onLog: on('creator:log'),
    use: (id) => ipcRenderer.send('creator:use', id),
  },
};

contextBridge.exposeInMainWorld('oru', api);
