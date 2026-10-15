export type Lang = 'en' | 'ml';

export type ReminderId = 'water' | 'stretch' | 'eyes' | 'posture' | 'push';

export const CLIP_NAMES = [
  'idle', 'walk_left', 'walk_right', 'wave', 'water_ask', 'drink_water', 'point',
  'sit', 'sleep', 'laugh', 'think', 'surprised',
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/** What to play when a character doesn't have a clip (followed until one exists, else idle). */
export const CLIP_FALLBACKS: Partial<Record<ClipName, ClipName>> = {
  walk_left: 'walk_right',
  walk_right: 'walk_left',
  water_ask: 'wave',
  drink_water: 'laugh',
  laugh: 'wave',
  point: 'wave',
  surprised: 'think',
};

export interface ReminderLine {
  text: string;
  yes?: string;
  later?: string;
  thanks?: string;
}

/** characters/<id>/manifest.json */
export interface CharacterManifest {
  name: string;
  author?: string;
  /** Rendered height in px at 100% scale. */
  height: number;
  /** How far the feet travel per second, in px of the *clip's own* resolution. */
  walkSpeed: number;
  /** Clip file per state, relative to the character folder. */
  clips: Partial<Record<ClipName, string>>;
  /** Clips that should loop (defaults: idle, walk_left, walk_right, sit, sleep). */
  loop?: ClipName[];
  /** Override which clip plays for a reminder, and after pressing Yes. */
  reminderClips?: Partial<Record<ReminderId, { ask?: ClipName; yes?: ClipName }>>;
  /** Line packs: lines.en.water = { text: "{name}, ..." } */
  lines?: Partial<Record<Lang, Partial<Record<ReminderId, ReminderLine>>>>;
  /** Voice lines: voices.ml.water = "voice/water_ml.mp3" */
  voices?: Partial<Record<Lang, Partial<Record<ReminderId, string>>>>;
  /** Free-form note about unfinished clips (ignored by the app). */
  todo?: string;
}

export interface CharacterInfo {
  id: string;
  /** Base URL that clips/voices resolve against, e.g. oru://app/char/placeholder/ */
  baseUrl: string;
  manifest: CharacterManifest;
}

export interface CharacterSummary {
  id: string;
  name: string;
  /** Clips the engine knows about that this character doesn't have yet. */
  missing: ClipName[];
}

export interface ReminderSetting {
  enabled: boolean;
  everyMin: number;
}

/** visit: off-screen until a reminder, walks in to the centre, asks, walks off the other side.
 *  wander: stays on screen and wanders around. */
export type Behaviour = 'visit' | 'wander';

export interface Settings {
  name: string;
  behaviour: Behaviour;
  lang: Lang;
  character: string;
  scale: number; // 0.5 - 1.5
  voice: boolean;
  volume: number; // 0 - 1
  startOnLogin: boolean;
  snoozeMin: number;
  reminders: Record<ReminderId, ReminderSetting>;
}

export interface ReminderPayload {
  id: ReminderId;
  text: string;
  yes: string;
  later: string;
  thanks: string;
  askClip: ClipName;
  yesClip: ClipName;
  voiceUrl: string | null;
  lang: Lang;
}

export interface CreatorRecipe {
  id: 'hello' | 'water' | 'walk';
  title: string;
  makes: ClipName[];
  prompt: string;
}

export interface CreatorPhoto {
  /** data: URL of the prepared image */
  preview: string;
  backdrop: string;
  warnings: string[];
}

export interface CreatorBuildRequest {
  name: string;
  videos: Partial<Record<CreatorRecipe['id'], string>>;
}

export type CreatorBuildResult =
  | { ok: true; id: string; clips: ClipName[]; warnings: string[] }
  | { ok: false; error: string };

export interface OruApi {
  // overlay
  onCharacter(fn: (c: CharacterInfo) => void): void;
  onSettings(fn: (s: Settings) => void): void;
  onRemind(fn: (r: ReminderPayload) => void): void;
  onPause(fn: (paused: boolean) => void): void;
  onBounds(fn: () => void): void;
  ready(): void;
  setInteractive(on: boolean): void;
  answer(id: ReminderId, choice: 'yes' | 'later'): void;
  cursor(): Promise<{ x: number; y: number } | null>;
  // settings window
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listCharacters(): Promise<CharacterSummary[]>;
  todayStats(): Promise<Record<string, number>>;
  openCharactersFolder(): void;
  testReminder(id: ReminderId): void;
  openCreator(): void;
  // character creator window
  creator: {
    info(): Promise<{ supported: boolean; recipes: CreatorRecipe[] }>;
    pick(kind: 'photo' | 'video'): Promise<string | null>;
    pathForFile(file: File): string;
    preparePhoto(src: string): Promise<CreatorPhoto>;
    saveImage(name: string): Promise<string | null>;
    copy(text: string): void;
    openGemini(): void;
    build(req: CreatorBuildRequest): Promise<CreatorBuildResult>;
    onLog(fn: (line: string) => void): void;
    use(id: string): void;
  };
}
