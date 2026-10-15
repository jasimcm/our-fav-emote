import type { OruApi, ReminderId, Settings } from '../shared/types';

const api = (window as unknown as { oru: OruApi }).oru;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LABELS: Record<ReminderId, string> = {
  water: '💧 Drink water',
  stretch: '🙆 Stretch',
  eyes: '👀 Eye break',
  posture: '🪑 Posture',
  push: '🚀 Push your code',
};

let s: Settings;
let saveTimer: number | undefined;

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await api.saveSettings(s);
    $('saved').textContent = 'Saved';
    setTimeout(() => ($('saved').textContent = ''), 1200);
  }, 250);
}

function bind<K extends keyof Settings>(
  id: string,
  key: K,
  read: (el: HTMLInputElement) => Settings[K],
  write: (el: HTMLInputElement, v: Settings[K]) => void,
): void {
  const el = $<HTMLInputElement>(id);
  write(el, s[key]);
  el.addEventListener(el.type === 'range' || el.type === 'text' ? 'input' : 'change', () => {
    s[key] = read(el);
    write(el, s[key]);
    save();
  });
}

async function init(): Promise<void> {
  s = await api.getSettings();

  const charSelect = $<HTMLSelectElement>('character');
  const characters = await api.listCharacters();
  for (const c of characters) charSelect.add(new Option(c.name, c.id, false, c.id === s.character));
  const showMissing = () => {
    const missing = characters.find((c) => c.id === charSelect.value)?.missing ?? [];
    $('missing').textContent = missing.length ? `Clips still to make: ${missing.join(', ')}` : '';
  };
  charSelect.addEventListener('change', showMissing);
  showMissing();

  bind('name', 'name', (el) => el.value.trim() || 'Friend', (el, v) => { if (document.activeElement !== el) el.value = v; });
  bind('lang', 'lang', (el) => el.value as Settings['lang'], (el, v) => (el.value = v));
  bind('behaviour', 'behaviour', (el) => el.value as Settings['behaviour'], (el, v) => (el.value = v));
  bind('character', 'character', (el) => el.value, (el, v) => (el.value = v));
  bind('scale', 'scale', (el) => Number(el.value) / 100, (el, v) => {
    el.value = String(Math.round(v * 100));
    $('scale-out').textContent = `${Math.round(v * 100)}%`;
  });
  bind('voice', 'voice', (el) => el.checked, (el, v) => (el.checked = v));
  bind('volume', 'volume', (el) => Number(el.value) / 100, (el, v) => {
    el.value = String(Math.round(v * 100));
    $('volume-out').textContent = `${Math.round(v * 100)}%`;
  });
  bind('snooze', 'snoozeMin', (el) => Math.max(1, Number(el.value) || 10), (el, v) => (el.value = String(v)));
  bind('login', 'startOnLogin', (el) => el.checked, (el, v) => (el.checked = v));

  const list = $('reminders');
  for (const id of Object.keys(LABELS) as ReminderId[]) {
    const row = document.createElement('div');
    row.className = 'reminder';
    row.innerHTML = `
      <input type="checkbox" aria-label="Enable" />
      <span>${LABELS[id]}</span>
      <span class="every">every <input type="number" min="1" max="600" /> min</span>
      <button type="button">Test</button>`;
    const [enabled, every] = row.querySelectorAll('input');
    enabled.checked = s.reminders[id].enabled;
    every.value = String(s.reminders[id].everyMin);
    enabled.addEventListener('change', () => { s.reminders[id].enabled = enabled.checked; save(); });
    every.addEventListener('change', () => {
      s.reminders[id].everyMin = Math.max(1, Number(every.value) || 1);
      every.value = String(s.reminders[id].everyMin);
      save();
    });
    row.querySelector('button')!.addEventListener('click', () => api.testReminder(id));
    list.appendChild(row);
  }

  $('open-folder').addEventListener('click', () => api.openCharactersFolder());
  $('create').addEventListener('click', () => api.openCreator());

  const stats = await api.todayStats();
  const water = stats.water ?? 0;
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  $('stats').textContent = total
    ? `Today: ${water} glass${water === 1 ? '' : 'es'} of water, ${total} reminder${total === 1 ? '' : 's'} done`
    : 'No reminders answered yet today';
}

init();
