// Portable background removal for the recipe videos (used on Windows; macOS uses Vision).
// The videos are generated on a plain backdrop that we chose to differ from the person's
// clothes, so a colour-difference key is enough and gives clean edges. Writes the same output
// as tools/segment.swift: <outDir>/<frame>.png (RGBA) and <outDir>/stats.jsonl.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ffmpegPath } from './tools';

export interface FrameStats { box: [number, number, number, number] | null; legsX?: number }

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(file: string): { w: number; h: number } {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// opponent-colour plane, brightness ignored (same measure as tools/segment.swift)
const cb = (r: number, g: number, b: number) => b - (r + g) / 2;
const cg = (r: number, g: number) => g - r;

/** Median colour of the frame border: the backdrop. */
function backdrop(px: Uint8Array, w: number, h: number): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const add = (x: number, y: number) => { const i = (y * w + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]); };
  for (let x = 0; x < w; x += 4) add(x, 2);
  for (let y = 0; y < (h * 3) / 4; y += 4) { add(2, y); add(w - 3, y); }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Keeps the largest connected shape (the person) plus a few px of its soft edge. */
function keepLargest(alpha: Uint8Array, w: number, h: number): void {
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (alpha[s] < 128 || label[s]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      if (x > 0 && !label[i - 1] && alpha[i - 1] >= 128) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && !label[i + 1] && alpha[i + 1] >= 128) { label[i + 1] = next; stack[top++] = i + 1; }
      if (i >= w && !label[i - w] && alpha[i - w] >= 128) { label[i - w] = next; stack[top++] = i - w; }
      if (i < w * (h - 1) && !label[i + w] && alpha[i + w] >= 128) { label[i + w] = next; stack[top++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  // grow the kept shape by 3px so its semi-transparent edge survives
  let keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) keep[i] = label[i] === best && best ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const grown = keep.slice();
    for (let i = 0; i < w * h; i++) {
      if (keep[i]) continue;
      const x = i % w;
      if ((x > 0 && keep[i - 1]) || (x < w - 1 && keep[i + 1]) || (i >= w && keep[i - w]) || (i < w * (h - 1) && keep[i + w])) grown[i] = 1;
    }
    keep = grown;
  }
  for (let i = 0; i < w * h; i++) if (!keep[i]) alpha[i] = 0;
}

/** Bounding box (alpha > 32) and the mean x of the bottom 35% (legs: stable while arms move). */
export function measure(alpha: Uint8Array, w: number, h: number): FrameStats {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 32) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { box: null };
  const legTop = maxY - Math.floor((maxY - minY) * 0.35);
  let sum = 0, n = 0;
  for (let y = legTop; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (alpha[y * w + x] > 32) { sum += x; n++; }
  return { box: [minX, minY, maxX, maxY], legsX: n ? sum / n : (minX + maxX) / 2 };
}

/** Keys one RGBA frame in place. */
function keyFrame(px: Uint8Array, w: number, h: number): FrameStats {
  const [br, bg, bb] = backdrop(px, w, h);
  const bgCb = cb(br, bg, bb), bgCg = cg(br, bg);
  const mag = Math.hypot(bgCb, bgCg);
  const saturated = mag > 30;
  const alpha = new Uint8Array(w * h);
  const keepF = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    // saturated backdrop: compare hue only (shadows and vignetting key out too);
    // a grey/white backdrop falls back to plain colour distance
    const keep = saturated
      ? (Math.hypot(cb(r, g, b) - bgCb, cg(r, g) - bgCg) - 0.3 * mag) / (0.5 * mag)
      : (Math.hypot(r - br, g - bg, b - bb) - 40) / 70;
    keepF[i] = Math.min(1, Math.max(0, keep));
    alpha[i] = Math.round(keepF[i] * 255);
  }
  keepLargest(alpha, w, h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i];
    px[i * 4 + 3] = a;
    if (!a || keepF[i] >= 1) continue;
    // edge pixel: remove the backdrop tint, then fade colour toward grey as it nears the backdrop
    let r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (bb > br && bb > bg - 20) b = Math.min(b, Math.max(r, g));
    if (bg > br + 40 && bg > bb) g = Math.min(g, Math.max(r, b));
    if (br > bg + 40 && bb > bg + 40) { r = Math.min(r, Math.max(g, b) + 10); b = Math.min(b, Math.max(r, g) + 10); }
    const k = keepF[i], lum = 0.3 * r + 0.59 * g + 0.11 * b;
    px[i * 4] = lum + (r - lum) * k;
    px[i * 4 + 1] = lum + (g - lum) * k;
    px[i * 4 + 2] = lum + (b - lum) * k;
  }
  return measure(alpha, w, h);
}

/**
 * Cuts the person out of every PNG frame in `inDir` (all the same size), writing RGBA PNGs and
 * stats.jsonl to `outDir`. Frames are streamed through ffmpeg, so memory stays at a few frames.
 */
export async function keyFrames(inDir: string, outDir: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(inDir).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('no frames');
  const { w, h } = pngSize(path.join(inDir, files[0]));
  const frameBytes = w * h * 4;

  const dec = spawn(ffmpegPath(), ['-loglevel', 'error', '-i', path.join(inDir, '%05d.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const enc = spawn(ffmpegPath(), ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', path.join(outDir, '%05d.png')], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  dec.stderr.on('data', (d) => (err += d));
  enc.stderr.on('data', (d) => (err += d));
  const encDone = new Promise<void>((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`keying failed: ${err.trim()}`)))));

  const stats: string[] = [];
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes) {
      const frame = new Uint8Array(pending.subarray(0, frameBytes));
      pending = pending.subarray(frameBytes);
      const s = keyFrame(frame, w, h);
      const name = `${String(stats.length + 1).padStart(5, '0')}.png`;
      stats.push(JSON.stringify({ f: name, w, h, box: s.box, ...(s.legsX !== undefined ? { legsX: +s.legsX.toFixed(1) } : {}) }));
      if (!enc.stdin.write(frame)) await new Promise((r) => enc.stdin.once('drain', r));
      onProgress?.(stats.length, files.length);
    }
  }
  enc.stdin.end();
  await encDone;
  fs.writeFileSync(path.join(outDir, 'stats.jsonl'), stats.join('\n') + '\n');
}
