// Video -> character clips. One background-removal pass per source video, then any number of
// clips are sliced from it, all on the same canvas so swapping clips never makes the person jump.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, ffmpegPath, run, segmentPath } from './tools';

export const W = 400, H = 640;
const FEET_Y = 630; // feet bottom on the canvas
const PERSON_H = 580; // head-top to feet
export const FPS = 24;
const TW = 40, TH = 64; // analysis thumbnails

export type Log = (msg: string) => void;

export interface VideoWork {
  label: string;
  dir: string;
  canvasDir: string;
  /** Frame count on the canvas (frame i is canvas/<i+1 padded>.png). */
  count: number;
  /** Person silhouette (alpha), TW x TH per frame, for motion analysis. */
  thumbs: Uint8Array[];
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const frameFile = (dir: string, i: number) => path.join(dir, `${String(i + 1).padStart(5, '0')}.png`);

interface FrameStat { f: string; box: [number, number, number, number] | null; legsX?: number }

/**
 * Extracts frames, cuts the person out, and renders every frame onto the shared canvas.
 * `walk` removes steady sideways drift so the person walks in place.
 */
export async function processVideo(
  src: string, opts: { label: string; walk?: boolean; from?: number; to?: number }, log: Log,
): Promise<VideoWork> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oru-${opts.label}-`));
  const frames = path.join(dir, 'frames'), cut = path.join(dir, 'cut'), canvasDir = path.join(dir, 'canvas');
  [frames, cut, canvasDir].forEach((d) => fs.mkdirSync(d));

  log(`${opts.label}: reading video`);
  await ffmpeg([
    ...(opts.from ? ['-ss', String(opts.from)] : []), ...(opts.to ? ['-to', String(opts.to)] : []),
    '-i', src, '-vf', `fps=${FPS}`, path.join(frames, '%05d.png'),
  ]);
  const total = fs.readdirSync(frames).filter((f) => f.endsWith('.png')).length;
  if (!total) throw new Error(`${opts.label}: no frames could be read from the video`);

  log(`${opts.label}: removing the background (${total} frames)`);
  await run(segmentPath(), [frames, cut], (line) => {
    const m = line.match(/segmented (\d+)\/(\d+)/);
    if (m) log(`${opts.label}: removing the background ${Math.round((100 * +m[1]) / +m[2])}%`);
  });
  const stats: FrameStat[] = fs.readFileSync(path.join(cut, 'stats.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const found = stats.map((s, i) => ({ ...s, i })).filter((s): s is FrameStat & { i: number; box: [number, number, number, number]; legsX: number } => !!s.box);
  if (found.length < total * 0.6) throw new Error(`${opts.label}: couldn't find the person in most frames`);

  // scale: head top uses the 70th percentile so a raised hand doesn't count as the head
  const feet = median(found.map((s) => s.box[3]));
  const head = pct(found.map((s) => s.box[1]), 0.7);
  const k = PERSON_H / (feet - head);
  let x0 = median(found.map((s) => s.legsX)), slope = 0;
  if (opts.walk) {
    const n = found.length, mi = found.reduce((s, f) => s + f.i, 0) / n, mx = found.reduce((s, f) => s + f.legsX, 0) / n;
    const v = found.reduce((s, f) => s + (f.i - mi) ** 2, 0);
    slope = v ? found.reduce((s, f) => s + (f.i - mi) * (f.legsX - mx), 0) / v : 0;
    x0 = mx - slope * mi;
  }

  // frames where nobody was found reuse the previous cut-out
  let last: string | null = null;
  for (let i = 0; i < total; i++) {
    const p = frameFile(cut, i);
    if (fs.existsSync(p)) last = p;
    else if (last) fs.copyFileSync(last, p);
  }

  log(`${opts.label}: placing on the canvas`);
  const PAD = 600, cw = W / k, ch = H / k;
  await ffmpeg([
    '-i', path.join(cut, '%05d.png'), '-filter_complex', [
      `[0]format=rgba,pad=iw+${2 * PAD}:ih+${2 * PAD}:${PAD}:${PAD}:color=black@0,`,
      `crop=${cw.toFixed(2)}:${ch.toFixed(2)}:'${(PAD + x0 - cw / 2).toFixed(2)}+${slope.toFixed(4)}*n':${(PAD + feet - FEET_Y / k).toFixed(2)},`,
      `scale=${W}:${H}:flags=lanczos,split[c][m];[m]alphaextract,erosion,gblur=sigma=0.6[al];[c][al]alphamerge`,
    ].join(''), path.join(canvasDir, '%05d.png'),
  ]);
  const count = fs.readdirSync(canvasDir).filter((f) => f.endsWith('.png')).length;

  const raw = await run(ffmpegPath(), ['-loglevel', 'error', '-i', path.join(canvasDir, '%05d.png'),
    '-vf', `alphaextract,scale=${TW}:${TH}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
  const thumbs = Array.from({ length: count }, (_, i) => raw.subarray(i * TW * TH, (i + 1) * TW * TH));
  return { label: opts.label, dir, canvasDir, count, thumbs };
}

export function cleanup(work: VideoWork): void {
  fs.rmSync(work.dir, { recursive: true, force: true });
}

const thumbDiff = (a: Uint8Array, b: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

export type Range = [number, number]; // [start, end) frame indices

/** Columns of the thumbnail the silhouette spans: arms at the sides = narrowest. */
function silhouetteWidth(t: Uint8Array): number {
  let c = 0;
  for (let x = 0; x < TW; x++) for (let y = 0; y < TH; y++) if (t[y * TW + x] > 128) { c++; break; }
  return c;
}

function medoid(frames: Uint8Array[]): Uint8Array {
  let ref = frames[0], bestScore = Infinity;
  for (const t of frames) {
    const score = median(frames.map((o) => thumbDiff(t, o)));
    if (score < bestScore) { bestScore = score; ref = t; }
  }
  return ref;
}

/**
 * The rest pose. The prompts ask to start and end standing still, so when the opening and closing
 * moments look alike, that's it. Otherwise (a clip that starts mid-action) fall back to the
 * narrowest silhouettes: arms at the sides. "Most common pose" isn't reliable, because actions can
 * take most of the video. Returns the reference and the frames that match it.
 */
function restPose(work: VideoWork): { ref: Uint8Array; restFrames: number[] } {
  const edge = Math.min(8, Math.floor(work.count / 4));
  const first = medoid(work.thumbs.slice(0, edge)), last = medoid(work.thumbs.slice(-edge));
  if (thumbDiff(first, last) < 6) {
    const ref = medoid([...work.thumbs.slice(0, edge), ...work.thumbs.slice(-edge)]);
    const restFrames = work.thumbs.map((t, i) => (thumbDiff(t, ref) < 6 ? i : -1)).filter((i) => i >= 0);
    return { ref, restFrames };
  }
  const widths = work.thumbs.map(silhouetteWidth);
  const cutoff = pct(widths, 0.15) + 1;
  const restFrames = widths.map((w, i) => (w <= cutoff ? i : -1)).filter((i) => i >= 0);
  return { ref: medoid(restFrames.filter((_, k) => k % 2 === 0).map((i) => work.thumbs[i])), restFrames };
}

/**
 * Finds actions separated by rest poses. The prompts ask for "return to standing relaxed" between
 * actions, so we measure how far each frame's silhouette is from the rest pose.
 * Returns up to `expected` actions in time order, plus the rest stretches.
 */
export function findActions(work: VideoWork, expected: number): { actions: Range[]; rests: Range[]; split: boolean } {
  const n = work.count;
  const { ref, restFrames } = restPose(work);
  const d = work.thumbs.map((t) => thumbDiff(t, ref));
  const smooth = d.map((_, i) => {
    const w = d.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const noise = median(restFrames.map((i) => smooth[i]));
  const peak = Math.max(...smooth);
  const thr = Math.max(noise + 0.3 * (peak - noise), noise * 1.6, 2);

  // runs above the threshold, merging short gaps and dropping blips
  let runs: Range[] = [];
  for (let i = 0; i < n; ) {
    if (smooth[i] <= thr) { i++; continue; }
    let j = i;
    while (j < n && smooth[j] > thr) j++;
    runs.push([i, j]);
    i = j;
  }
  runs = runs.reduce<Range[]>((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && r[0] - prev[1] < FPS * 0.25) prev[1] = r[1];
    else acc.push([...r]);
    return acc;
  }, []).filter(([a, b]) => b - a >= FPS * 0.4);

  // fewer actions than expected: if one run fills most of the video, two actions probably ran
  // together, so split it at the calmest moment in its middle
  let split = false;
  while (runs.length < expected && runs.length) {
    const longest = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    const [a, b] = longest;
    if (b - a < n * 0.55) break;
    const lo = a + Math.round((b - a) * 0.2), hi = b - Math.round((b - a) * 0.2);
    if (hi - lo < FPS * 0.5) break;
    let cut = lo;
    for (let i = lo; i < hi; i++) if (smooth[i] < smooth[cut]) cut = i;
    runs.splice(runs.indexOf(longest), 1, [a, cut], [cut, b]);
    split = true;
  }
  if (runs.length > expected) {
    runs = [...runs].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, expected).sort((p, q) => p[0] - q[0]);
  }

  // pad each action with a little rest on both sides (without overlapping the next one)
  const pad = Math.round(FPS * 0.2);
  const actions = runs.map(([a, b], i): Range => [
    Math.max(i ? runs[i - 1][1] : 0, a - pad),
    Math.min(i < runs.length - 1 ? runs[i + 1][0] : n, b + pad),
  ]);
  const rests: Range[] = [];
  let prevEnd = 0;
  for (const [a, b] of runs) { if (a > prevEnd) rests.push([prevEnd, a]); prevEnd = b; }
  if (prevEnd < n) rests.push([prevEnd, n]);
  return { actions, rests, split };
}

/** Start/end frames inside `range` whose silhouettes match best, for a loop between minS and maxS seconds. */
export function bestLoop(work: VideoWork, range: Range, minS: number, maxS: number): { range: Range; seam: number } {
  let best = Infinity, out: Range = range;
  const [a, b] = range;
  for (let i = a; i < b; i++) {
    for (let j = i + Math.round(minS * FPS); j <= Math.min(b - 1, i + Math.round(maxS * FPS)); j++) {
      const s = thumbDiff(work.thumbs[i], work.thumbs[j]) + 0.5 * thumbDiff(work.thumbs[Math.min(i + 1, b - 1)], work.thumbs[Math.min(j + 1, b - 1)]);
      if (s < best) { best = s; out = [i, j]; }
    }
  }
  return { range: out, seam: best };
}

/** The planted foot is the only thing touching the ground: how fast it slides back = walk speed (canvas px/s). */
export async function measureWalkSpeed(work: VideoWork, [a, b]: Range): Promise<number> {
  const BAND = 6;
  const raw = await run(ffmpegPath(), ['-loglevel', 'error', '-start_number', String(a + 1), '-i', path.join(work.canvasDir, '%05d.png'),
    '-frames:v', String(b - a), '-vf', `crop=${W}:${BAND}:0:${FEET_Y - BAND - 2},alphaextract,format=gray`, '-f', 'rawvideo', '-']);
  const profiles: Float64Array[] = [];
  for (let i = 0; i < raw.length / (W * BAND); i++) {
    const col = new Float64Array(W);
    for (let y = 0; y < BAND; y++) for (let x = 0; x < W; x++) col[x] += raw[i * W * BAND + y * W + x];
    profiles.push(col);
  }
  const shifts: number[] = [];
  for (let i = 1; i < profiles.length; i++) {
    let bestS = 0, bestScore = -Infinity;
    for (let s = -20; s <= 20; s++) {
      let score = 0;
      for (let x = 20; x < W - 20; x++) score += profiles[i - 1][x] * profiles[i][x + s];
      if (score > bestScore) { bestScore = score; bestS = s; }
    }
    shifts.push(bestS);
  }
  return Math.max(40, Math.round(Math.abs(median(shifts)) * FPS));
}

/**
 * Encodes frames as a VP9-with-alpha WebM. `pingpong` plays the range forward then backward,
 * which loops seamlessly (used for idle made from a short rest stretch).
 */
export async function encodeClip(work: VideoWork, out: string, range: Range, opts: { fps?: number; pingpong?: boolean } = {}): Promise<void> {
  const fps = opts.fps ?? FPS;
  const step = Math.max(1, Math.round(FPS / fps));
  const idx: number[] = [];
  for (let i = range[0]; i < range[1]; i += step) idx.push(i);
  if (opts.pingpong) idx.push(...idx.slice(1, -1).reverse());
  const seq = fs.mkdtempSync(path.join(work.dir, 'seq-'));
  idx.forEach((f, i) => fs.linkSync(frameFile(work.canvasDir, f), frameFile(seq, i)));
  await ffmpeg(['-framerate', String(fps), '-i', path.join(seq, '%05d.png'),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-auto-alt-ref', '0', out]);
  fs.rmSync(seq, { recursive: true, force: true });
}

export const seconds = ([a, b]: Range) => `${(a / FPS).toFixed(2)}-${(b / FPS).toFixed(2)}s`;
