import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CharacterInfo, ClipName, Lang, ReminderId, ReminderLine, ReminderPayload, Settings,
} from '../shared/types';

export const REMINDER_IDS: ReminderId[] = ['water', 'stretch', 'eyes', 'posture', 'push'];

const BUILT_IN_LINES: Record<Lang, Record<ReminderId, ReminderLine> & { _buttons: { yes: string; later: string } }> = {
  en: {
    _buttons: { yes: 'Yes', later: 'Remind me later' },
    water: { text: '{name}, time to drink some water! 💧', thanks: 'Good! Stay hydrated 😄' },
    stretch: { text: '{name}, stand up and stretch a bit 🙆', yes: 'Done', thanks: 'Nice, your back says thanks!' },
    eyes: { text: 'Look at something 20 feet away for 20 seconds 👀', yes: 'OK', thanks: 'Eyes rested ✨' },
    posture: { text: '{name}, sit up straight! 🪑', yes: 'Fixed', thanks: 'Much better 👌' },
    push: { text: '{name}, have you pushed your code? 🚀', yes: 'Pushed', thanks: 'Ship it! 🎉' },
  },
  ml: {
    _buttons: { yes: 'ശരി', later: 'പിന്നെ ഓർമ്മിപ്പിക്കൂ' },
    water: { text: '{name}, കുറച്ച് വെള്ളം കുടിക്കാൻ സമയമായി! 💧', thanks: 'അടിപൊളി! 😄' },
    stretch: { text: '{name}, ഒന്ന് എഴുന്നേറ്റ് ശരീരം നിവർത്തൂ 🙆', thanks: 'നടു ഹാപ്പി ആയി!' },
    eyes: { text: '20 അടി ദൂരേക്ക് 20 സെക്കൻഡ് നോക്കൂ 👀', thanks: 'കണ്ണിന് ഒരു ബ്രേക്ക് ✨' },
    posture: { text: '{name}, നേരെ ഇരിക്കൂ! 🪑', thanks: 'ഇപ്പൊ കൊള്ളാം 👌' },
    push: { text: '{name}, കോഡ് push ചെയ്തോ? 🚀', thanks: 'പൊളി! 🎉' },
  },
};

const DEFAULT_CLIPS: Record<ReminderId, { ask: ClipName; yes: ClipName }> = {
  water: { ask: 'water_ask', yes: 'drink_water' },
  stretch: { ask: 'wave', yes: 'laugh' },
  eyes: { ask: 'think', yes: 'laugh' },
  posture: { ask: 'point', yes: 'laugh' },
  push: { ask: 'point', yes: 'laugh' },
};

export class Reminders {
  private timers = new Map<ReminderId, NodeJS.Timeout>();
  private queue: ReminderId[] = [];
  private showing: ReminderId | null = null;
  private held = false;

  constructor(
    private getSettings: () => Settings,
    private getCharacter: () => CharacterInfo | null,
    private send: (r: ReminderPayload) => void,
  ) {}

  start(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    const s = this.getSettings();
    for (const id of REMINDER_IDS) {
      if (s.reminders[id].enabled) this.schedule(id, s.reminders[id].everyMin);
    }
  }

  /** While held (paused / fullscreen app), reminders queue up instead of showing. */
  hold(on: boolean): void {
    this.held = on;
    if (!on) this.next();
  }

  trigger(id: ReminderId): void {
    if (this.showing !== id && !this.queue.includes(id)) this.queue.push(id);
    this.next();
  }

  answer(id: ReminderId, choice: 'yes' | 'later'): void {
    if (this.showing !== id) return;
    this.showing = null;
    const s = this.getSettings();
    if (choice === 'yes') {
      logAnswer(id);
      if (s.reminders[id].enabled) this.schedule(id, s.reminders[id].everyMin);
    } else {
      this.schedule(id, s.snoozeMin);
    }
    setTimeout(() => this.next(), 5000);
  }

  private schedule(id: ReminderId, minutes: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.trigger(id), Math.max(1, minutes) * 60_000));
  }

  private next(): void {
    if (this.held || this.showing || !this.queue.length) return;
    const id = this.queue.shift()!;
    this.showing = id;
    this.send(this.payload(id));
  }

  private payload(id: ReminderId): ReminderPayload {
    const s = this.getSettings();
    const ch = this.getCharacter();
    const m = ch?.manifest;
    const lang = s.lang;
    const builtIn = BUILT_IN_LINES[lang];
    const line: ReminderLine = { ...builtIn[id], ...(m?.lines?.[lang]?.[id] ?? {}) };
    const fill = (t: string) => t.replaceAll('{name}', s.name);
    const voice = m?.voices?.[lang]?.[id];
    return {
      id,
      lang,
      text: fill(line.text),
      yes: line.yes ?? builtIn._buttons.yes,
      later: line.later ?? builtIn._buttons.later,
      thanks: fill(line.thanks ?? '👍'),
      askClip: m?.reminderClips?.[id]?.ask ?? DEFAULT_CLIPS[id].ask,
      yesClip: m?.reminderClips?.[id]?.yes ?? DEFAULT_CLIPS[id].yes,
      voiceUrl: voice && ch ? ch.baseUrl + voice : null,
    };
  }
}

// ---- log: one JSON line per "Yes" ----
const logFile = () => path.join(app.getPath('userData'), 'reminder-log.jsonl');

function logAnswer(id: ReminderId): void {
  fs.appendFileSync(logFile(), JSON.stringify({ id, at: new Date().toISOString() }) + '\n');
}

export function todayStats(): Record<string, number> {
  const today = new Date().toDateString();
  const counts: Record<string, number> = {};
  try {
    for (const line of fs.readFileSync(logFile(), 'utf8').split('\n')) {
      if (!line) continue;
      const { id, at } = JSON.parse(line);
      if (new Date(at).toDateString() === today) counts[id] = (counts[id] ?? 0) + 1;
    }
  } catch {
    /* no log yet */
  }
  return counts;
}
