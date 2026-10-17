import { CLIP_FALLBACKS, type CharacterInfo, type ClipName, type OruApi, type ReminderPayload, type Settings } from '../shared/types';

const api = (window as unknown as { oru: OruApi }).oru;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const charEl = $<HTMLDivElement>('char');
const video = $<HTMLVideoElement>('clip');
const ghost = $<HTMLCanvasElement>('ghost');
const ghostCtx = ghost.getContext('2d')!;
const bubble = $<HTMLDivElement>('bubble');
const bubbleText = $<HTMLParagraphElement>('bubble-text');
const bubbleActions = $<HTMLDivElement>('bubble-actions');
const btnYes = $<HTMLButtonElement>('btn-yes');
const btnLater = $<HTMLButtonElement>('btn-later');

const CROSSFADE_MS = 120;
const DEFAULT_LOOPS: ClipName[] = ['idle', 'walk_left', 'walk_right', 'sit', 'sleep'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

let settings: Settings | null = null;
let character: CharacterInfo | null = null;
let clipUrls = new Map<ClipName, string>();
let loops = new Set<ClipName>(DEFAULT_LOOPS);
let clipHeight = 0; // native pixel height of the clips
let clipAspect = 0.45; // width / height of the clips

// ---------- position ----------
let cx = window.innerWidth - 300; // center x of the character
let y = 0; // height above the ground (bottom of the window = just above the taskbar)
let facing: 'left' | 'right' = 'left';

const renderedHeight = () => (character?.manifest.height ?? 300) * (settings?.scale ?? 1);
// from the clip's own proportions, not layout: the element has no size for a moment while a clip swaps
const charWidth = () => renderedHeight() * clipAspect;
const visiting = () => settings?.behaviour !== 'wander';
// visit mode walks in from (and out to) beyond the screen edges, so nothing is clamped there
const clampX = (x: number) =>
  visiting() ? x : Math.max(charWidth() / 2, Math.min(window.innerWidth - charWidth() / 2, x));

function place(): void {
  cx = clampX(cx);
  charEl.style.transform = `translate(${Math.round(cx - charWidth() / 2)}px, ${-Math.round(y)}px)`;
  charEl.classList.toggle('airborne', y > 2);
  if (bubble.classList.contains('show')) placeBubble();
}

function placeBubble(): void {
  const bw = bubble.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, cx - bw / 2));
  bubble.style.left = `${left}px`;
  bubble.style.bottom = `${y + renderedHeight() + 14}px`;
  bubble.style.setProperty('--tail', `${Math.max(22, Math.min(bw - 22, cx - left))}px`);
}

// ---------- clips: one <video>, swapped sources, 120ms crossfade via a canvas snapshot ----------
let currentClip: { name: ClipName; mirrored: boolean } | null = null;
let clipToken = 0;

function resolveClip(name: ClipName, dir?: 'left' | 'right'): { url: string; name: ClipName; mirrored: boolean } {
  const has = (n: ClipName) => clipUrls.has(n);
  if (name === 'walk_left' && !has('walk_left') && has('walk_right')) return { url: clipUrls.get('walk_right')!, name, mirrored: true };
  if (name === 'walk_right' && !has('walk_right') && has('walk_left')) return { url: clipUrls.get('walk_left')!, name, mirrored: true };
  for (let i = 0; i < 4 && !has(name); i++) name = CLIP_FALLBACKS[name] ?? 'idle';
  if (!has(name)) name = 'idle';
  // only pointing is directional (authored pointing right); mirroring a face-on clip would just flip the face
  const mirrored = dir === 'left' && name === 'point';
  return { url: clipUrls.get(name)!, name, mirrored };
}

/** Plays a clip. Resolves when a one-shot clip ends (looping clips resolve immediately). */
function play(want: ClipName, dir?: 'left' | 'right'): Promise<void> {
  const clip = resolveClip(want, dir);
  if (!clip.url) return Promise.resolve();
  const token = ++clipToken;
  const looping = loops.has(clip.name);
  if (looping && currentClip?.name === clip.name && currentClip.mirrored === clip.mirrored) return Promise.resolve();

  // snapshot the current frame so the swap is invisible
  if (video.readyState >= 2 && video.videoWidth) {
    ghost.width = video.videoWidth;
    ghost.height = video.videoHeight;
    ghostCtx.clearRect(0, 0, ghost.width, ghost.height);
    ghostCtx.drawImage(video, 0, 0);
    ghost.style.width = `${video.offsetWidth}px`;
    ghost.style.height = `${video.offsetHeight}px`;
    ghost.style.transform = `translateX(-50%)${currentClip?.mirrored ? ' scaleX(-1)' : ''}`;
    ghost.style.transition = 'none';
    ghost.style.opacity = '1';
  }

  currentClip = { name: clip.name, mirrored: clip.mirrored };
  video.loop = looping;
  video.src = clip.url;
  video.dataset.clip = clip.name;
  video.style.transform = clip.mirrored ? 'scaleX(-1)' : '';
  video.play().catch(() => {});

  const fadeGhost = () => {
    if (token !== clipToken) return;
    ghost.style.transition = `opacity ${CROSSFADE_MS}ms linear`;
    ghost.style.opacity = '0';
  };
  video.requestVideoFrameCallback(() => fadeGhost());

  if (looping) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('ended', done); resolve(); };
    video.addEventListener('ended', done);
  });
}

async function preload(c: CharacterInfo): Promise<void> {
  const next = new Map<ClipName, string>();
  await Promise.all(
    Object.entries(c.manifest.clips).map(async ([name, file]) => {
      try {
        const res = await fetch(c.baseUrl + file);
        if (res.ok) next.set(name as ClipName, URL.createObjectURL(await res.blob()));
      } catch (e) {
        console.warn('clip failed', name, e);
      }
    }),
  );
  clipUrls.forEach((u) => URL.revokeObjectURL(u));
  clipUrls = next;
  loops = new Set(c.manifest.loop ?? DEFAULT_LOOPS);
  // read the clips' native height (needed to convert walkSpeed to screen px)
  const probe = document.createElement('video');
  probe.src = clipUrls.get('idle') ?? [...clipUrls.values()][0];
  await new Promise((r) => { probe.onloadedmetadata = r; probe.onerror = r; });
  clipHeight = probe.videoHeight || 0;
  if (probe.videoWidth && probe.videoHeight) clipAspect = probe.videoWidth / probe.videoHeight;
}

// ---------- brain: weighted random state machine ----------
type Mode = 'loading' | 'idle' | 'walk' | 'action' | 'talk' | 'drag' | 'fall' | 'paused';
let mode: Mode = 'loading';
let gen = 0; // bumped on every interruption; stale async steps check it and bail
let stateTimer: number | undefined;
let walkTarget = 0;
let afterWalk: (() => void) | null = null;

function interrupt(): number {
  clearTimeout(stateTimer);
  afterWalk = null;
  return ++gen;
}

function scheduleNext(ms: number): void {
  clearTimeout(stateTimer);
  const g = gen;
  stateTimer = window.setTimeout(() => g === gen && nextState(), ms);
}

const WEIGHTS: [string, number][] = [
  ['walk', 42], ['idle', 18], ['cursor', 10], ['wave', 7], ['think', 7], ['laugh', 6], ['sit', 6], ['sleep', 4],
];
/** States that need their own clip are skipped when the character doesn't have it. */
function pickState(): string {
  const needs: Record<string, ClipName[]> = {
    walk: ['walk_right', 'walk_left'], cursor: ['walk_right', 'walk_left'],
    wave: ['wave'], think: ['think'], laugh: ['laugh'], sit: ['sit'], sleep: ['sleep'],
  };
  const options = WEIGHTS.filter(([name]) => !needs[name] || needs[name].some((c) => clipUrls.has(c)));
  let r = Math.random() * options.reduce((s, [, w]) => s + w, 0);
  for (const [name, w] of options) if ((r -= w) < 0) return name;
  return 'idle';
}

function idle(ms = rand(4000, 12000)): void {
  mode = 'idle';
  play('idle');
  scheduleNext(ms);
}

async function nextState(): Promise<void> {
  if (visiting()) return; // visits are driven by reminders, not by the random brain
  if (mode === 'talk' || mode === 'drag' || mode === 'fall' || mode === 'paused' || !character) return;
  const g = gen;
  const state = pickState();
  switch (state) {
    case 'walk': {
      const margin = charWidth();
      let target = cx;
      for (let i = 0; i < 8 && Math.abs(target - cx) < 180; i++) target = rand(margin, window.innerWidth - margin);
      walkTo(target, () => idle());
      break;
    }
    case 'cursor': {
      const p = await api.cursor();
      if (g !== gen) return;
      if (!p) return idle();
      walkTo(p.x + (p.x < cx ? 90 : -90), async () => {
        if (!clipUrls.has('point')) return idle(); // just come over and stand there
        mode = 'action';
        await play('point', p.x < cx ? 'left' : 'right');
        if (g === gen) idle();
      });
      break;
    }
    case 'wave': case 'think': case 'laugh': {
      mode = 'action';
      await play(state as ClipName, facing);
      if (g === gen) idle(rand(3000, 8000));
      break;
    }
    case 'sit': case 'sleep': {
      mode = 'action';
      play(state as ClipName);
      scheduleNext(rand(8000, 20000));
      break;
    }
    default:
      idle();
  }
}

function walkTo(target: number, then: () => void): void {
  walkTarget = clampX(target);
  if (Math.abs(walkTarget - cx) < 4) return then();
  facing = walkTarget < cx ? 'left' : 'right';
  mode = 'walk';
  afterWalk = then;
  play(facing === 'left' ? 'walk_left' : 'walk_right');
  startLoop();
}

/** Screen px per second, derived from the manifest so the feet don't slide. */
function walkPxPerSec(): number {
  const m = character!.manifest;
  const ratio = clipHeight ? renderedHeight() / clipHeight : (settings?.scale ?? 1);
  return m.walkSpeed * ratio;
}

// ---------- visits: walk in from one side, ask, walk out the other side ----------
let away = true; // off-screen between visits (the character starts hidden)
let nextEntry: 'left' | 'right' = 'left';
const offLeft = () => -charWidth() / 2 - 12;
const offRight = () => window.innerWidth + charWidth() / 2 + 12;
const offscreen = () => cx < 0 || cx > window.innerWidth;

/** Walks in from the side where the last visit ended, to near the centre. */
function arrive(then: () => void): void {
  if (!away && !offscreen()) return then();
  away = false;
  if (offscreen() || charEl.hidden) cx = nextEntry === 'left' ? offLeft() : offRight();
  y = 0;
  charEl.hidden = false;
  video.play().catch(() => {});
  place();
  walkTo(window.innerWidth / 2 + rand(-60, 60), then);
}

/** Walks off the side opposite the one it came in from, then waits off-screen (video paused). */
function leave(): void {
  const g = gen;
  const exit: 'left' | 'right' = nextEntry === 'left' ? 'right' : 'left';
  walkTo(exit === 'right' ? offRight() : offLeft(), () => {
    if (g !== gen) return;
    away = true;
    nextEntry = exit;
    mode = 'idle';
    charEl.hidden = true;
    video.pause();
    setInteractive(false);
  });
}

/** What to do once an interaction is over: leave (visit mode) or carry on idling (wander mode). */
function settle(ms = rand(3000, 6000)): void {
  if (visiting()) leave();
  else idle(ms);
}

// ---------- animation loop: only runs while moving (keeps idle CPU near zero) ----------
let rafId = 0;
let lastT = 0;
let vy = 0;

function startLoop(): void {
  if (rafId) return;
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(t: number): void {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  let moving = false;

  if (mode === 'walk') {
    const dir = facing === 'left' ? -1 : 1;
    cx += dir * walkPxPerSec() * dt;
    if ((walkTarget - cx) * dir <= 0) {
      cx = walkTarget;
      const then = afterWalk;
      afterWalk = null;
      then?.();
    }
    moving = mode === 'walk';
  } else if (mode === 'fall') {
    vy += 2600 * dt;
    y -= vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
      land();
    } else moving = true;
  }

  place();
  rafId = moving ? requestAnimationFrame(tick) : 0;
}

// ---------- drag: pick up and drop ----------
let drag: { offX: number; offY: number; startX: number; startY: number; moved: boolean } | null = null;

video.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || mode === 'loading') return;
  drag = { offX: e.clientX - cx, offY: window.innerHeight - e.clientY - y, startX: e.clientX, startY: e.clientY, moved: false };
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    interrupt();
    if (mode !== 'talk') mode = 'drag';
    charEl.classList.add('dragging');
    play('surprised', facing);
  }
  cx = e.clientX - drag.offX;
  y = Math.max(0, Math.min(window.innerHeight - renderedHeight(), window.innerHeight - e.clientY - drag.offY));
  place();
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  charEl.classList.remove('dragging');
  syncInteractive(e);
  if (!moved) return poke();
  if (mode === 'talk') { y = 0; place(); return; }
  mode = 'fall';
  startLoop();
});

function land(): void {
  if (pendingReminder) {
    showReminder(pendingReminder);
    return;
  }
  const g = gen;
  play('surprised', facing).then(() => g === gen && settle(rand(2000, 5000)));
  mode = 'action';
}

const POKES = ['Hey! 👋', 'Working hard? 💻', 'Ayyo, that tickles 😄', 'Ship it! 🚀'];
function poke(): void {
  if (mode === 'talk') return;
  const g = interrupt();
  mode = 'action';
  say(POKES[Math.floor(Math.random() * POKES.length)], false, 2200);
  play('laugh', facing).then(() => g === gen && settle());
}

// ---------- click-through everywhere except the character and the bubble ----------
let interactive = false;
function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
}
for (const el of [video, bubble]) {
  el.addEventListener('mouseenter', () => setInteractive(true));
  el.addEventListener('mouseleave', () => !drag && setInteractive(false));
}
function syncInteractive(e: MouseEvent): void {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setInteractive(!!el && (el === video || bubble.contains(el)) && (el === video || bubble.classList.contains('show')));
}

// ---------- reminders + speech bubble ----------
let current: ReminderPayload | null = null;
let pendingReminder: ReminderPayload | null = null;
let hideTimer: number | undefined;

function say(text: string, withActions: boolean, hideAfterMs?: number): void {
  clearTimeout(hideTimer);
  bubbleText.textContent = text;
  bubbleActions.hidden = !withActions;
  bubble.classList.add('show');
  placeBubble();
  if (hideAfterMs) hideTimer = window.setTimeout(() => bubble.classList.remove('show'), hideAfterMs);
}

function speak(r: ReminderPayload): void {
  if (!settings?.voice) return;
  const volume = settings.volume;
  if (r.voiceUrl) {
    const a = new Audio(r.voiceUrl);
    a.volume = volume;
    a.play().catch(() => {});
    return;
  }
  const u = new SpeechSynthesisUtterance(r.text.replace(/\p{Extended_Pictographic}/gu, ''));
  u.lang = r.lang === 'ml' ? 'ml-IN' : 'en-IN';
  u.volume = volume;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

async function showReminder(r: ReminderPayload): Promise<void> {
  pendingReminder = null;
  const g = interrupt();
  current = r;
  if (visiting() && (away || offscreen())) {
    arrive(() => g === gen && ask(r, g));
    return;
  }
  ask(r, g);
}

async function ask(r: ReminderPayload, g: number): Promise<void> {
  mode = 'talk';
  y = 0;
  place();
  btnYes.textContent = r.yes;
  btnLater.textContent = r.later;
  say(r.text, true);
  speak(r);
  await play(r.askClip, facing);
  if (g === gen && current === r) play('idle');
}

api.onRemind((r) => {
  // still loading the clips: show it once the character is ready
  if (mode === 'loading' || mode === 'drag' || mode === 'fall' || mode === 'paused') pendingReminder = r;
  else showReminder(r);
});

btnYes.addEventListener('click', async () => {
  const r = current;
  if (!r) return;
  current = null;
  api.answer(r.id, 'yes');
  const g = interrupt();
  mode = 'action';
  say(r.thanks, false, 3000);
  await play(r.yesClip, facing);
  if (g === gen) settle();
});

btnLater.addEventListener('click', () => {
  const r = current;
  if (!r) return;
  current = null;
  api.answer(r.id, 'later');
  const g = interrupt();
  say(settings?.lang === 'ml' ? `ശരി, ${settings.snoozeMin} മിനിറ്റ് കഴിഞ്ഞ് ഓർമ്മിപ്പിക്കാം` : `Okay, I'll remind you in ${settings?.snoozeMin ?? 10} min`, false, 2500);
  mode = 'idle';
  play('idle');
  stateTimer = window.setTimeout(() => g === gen && settle(), 1200);
});

// ---------- wiring ----------
function applyScale(): void {
  video.style.height = `${renderedHeight()}px`;
  video.style.width = `${charWidth()}px`;
  place();
}

api.onSettings((s) => {
  const was = settings?.behaviour;
  settings = s;
  applyScale();
  if (!was || was === s.behaviour || !character || current) return;
  interrupt();
  if (s.behaviour === 'visit') leave();
  else arrive(() => idle()); // walk back in and stay
});

api.onCharacter(async (c) => {
  interrupt();
  mode = 'loading';
  character = c;
  await preload(c);
  currentClip = null;
  applyScale();
  play('idle');
  if (pendingReminder && !current) {
    // a reminder arrived while the clips were loading: that's the first visit
    greeted = true;
    mode = 'idle';
    showReminder(pendingReminder);
    return;
  }
  if (visiting() && !current) {
    // say hello with a short visit (also shows off a newly chosen character)
    if (!away && !offscreen()) away = true;
    charEl.hidden = true;
    const g = gen;
    const hi = greeted ? (settings?.lang === 'ml' ? 'ഞാൻ എത്തി! 👋' : "It's me now! 👋") : null;
    greeted = true;
    arrive(() => {
      if (g !== gen) return;
      mode = 'action';
      say(hi ?? (settings?.lang === 'ml' ? `ഹായ് ${settings.name}! 👋` : `Hi ${settings?.name ?? 'there'}! 👋`), false, 3000);
      play('wave').then(() => g === gen && settle());
    });
    return;
  }
  away = false;
  charEl.hidden = false;
  requestAnimationFrame(() => place());
  if (current) {
    mode = 'talk';
  } else if (!greeted) {
    greeted = true;
    const g = gen;
    mode = 'action';
    say(settings?.lang === 'ml' ? `ഹായ് ${settings.name}! 👋` : `Hi ${settings?.name ?? 'there'}! 👋`, false, 3000);
    play('wave').then(() => g === gen && idle(rand(2000, 5000)));
  } else {
    mode = 'idle';
    scheduleNext(1500);
  }
});
let greeted = false;

api.onPause((paused) => {
  if (paused) {
    interrupt();
    if (mode !== 'talk') mode = 'paused';
    video.pause();
    speechSynthesis.cancel();
    return;
  }
  if (!away) video.play().catch(() => {});
  if (pendingReminder) return showReminder(pendingReminder);
  if (mode !== 'paused') return;
  if (!visiting()) idle(rand(1000, 3000));
  else if (away) mode = 'idle';
  else leave();
});

api.onBounds(() => {
  if (drag || away) return;
  if (mode === 'fall') { y = 0; land(); }
  y = 0;
  place();
});
window.addEventListener('resize', () => place());

api.ready();
