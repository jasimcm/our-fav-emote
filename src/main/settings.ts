import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  name: 'Friend',
  behaviour: 'visit',
  lang: 'en',
  character: 'placeholder',
  scale: 1,
  voice: false,
  volume: 0.8,
  startOnLogin: false,
  snoozeMin: 10,
  reminders: {
    water: { enabled: true, everyMin: 45 },
    stretch: { enabled: true, everyMin: 60 },
    eyes: { enabled: true, everyMin: 20 },
    posture: { enabled: true, everyMin: 30 },
    push: { enabled: true, everyMin: 90 },
  },
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      reminders: { ...DEFAULT_SETTINGS.reminders, ...(saved.reminders ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
}
