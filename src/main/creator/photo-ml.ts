// Portable person cut-out for the photo (used on Windows; macOS uses Vision). The photo can have
// any background, so this needs a segmentation model: U²-Net human segmentation (Apache-2.0),
// downloaded once (~176 MB) and run with onnxruntime-node.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { measure, pngSize, type FrameStats } from './keyer';
import { ffmpeg, ffmpegPath, run } from './tools';

const MODEL = {
  file: 'u2net_human_seg.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx',
  sha256: '01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c',
  bytes: 175_997_641,
};
const SIZE = 320; // model input

export type Progress = (msg: string) => void;

/** Downloads the model into `dir` the first time, verifying its checksum. */
async function ensureModel(dir: string, progress: Progress): Promise<string> {
  const file = path.join(dir, MODEL.file);
  if (fs.existsSync(file) && fs.statSync(file).size === MODEL.bytes) return file;
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(MODEL.url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the background-removal model (${res.status}). Check your internet connection.`);
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  const hash = createHash('sha256');
  let got = 0, lastPct = -1;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    const pct = Math.floor((100 * got) / MODEL.bytes);
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; progress(`Downloading the background-removal model (once, 176 MB): ${pct}%`); }
  }
  await new Promise<void>((r) => out.end(r));
  if (hash.digest('hex') !== MODEL.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error('The downloaded model was corrupted. Please try again.');
  }
  fs.renameSync(tmp, file);
  return file;
}

/** EXIF orientation of a JPEG (1 = upright), so phone photos come out the right way up. */
function jpegOrientation(file: string): number {
  const b = fs.readFileSync(file);
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  for (let i = 2; i + 4 < b.length;) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.toString('ascii', i + 4, i + 8) === 'Exif') {
      const t = i + 10, le = b.toString('ascii', t, t + 2) === 'II';
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      for (let e = 0; e < u16(ifd); e++) {
        const entry = ifd + 2 + e * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8);
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}

const ORIENT_FILTER: Record<number, string> = {
  2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2',
};

/** Decodes a photo to upright RGBA (longest side at most 2048 px). */
async function decode(src: string): Promise<{ px: Uint8Array; w: number; h: number }> {
  const ext = path.extname(src).toLowerCase();
  if (ext === '.heic' || ext === '.heif') throw new Error('HEIC photos aren\'t supported here yet. Export the photo as JPEG and try again.');
  const orient = ext === '.jpg' || ext === '.jpeg' ? jpegOrientation(src) : 1;
  const filters = [ORIENT_FILTER[orient], "scale='if(gt(iw,ih),min(2048,iw),-2)':'if(gt(iw,ih),-2,min(2048,ih))'"].filter(Boolean).join(',');
  // some ffmpeg builds rotate JPEGs themselves; -noautorotate leaves it to the filter above
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oru-dec-'));
  const outPng = path.join(dir, 'upright.png');
  await ffmpeg(['-noautorotate', '-i', src, '-vf', filters, '-frames:v', '1', outPng]);
  const { w, h } = pngSize(outPng);
  const px = await run(ffmpegPath(), ['-loglevel', 'error', '-i', outPng, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  fs.rmSync(dir, { recursive: true, force: true });
  return { px: new Uint8Array(px), w, h };
}

/**
 * Cuts the person out of a photo. Writes an upright RGBA PNG to `out` and returns the same
 * stats as tools/segment.swift (size, bounding box, legs centre).
 */
export async function cutOutPhoto(src: string, out: string, modelsDir: string, progress: Progress): Promise<FrameStats & { w: number; h: number }> {
  const ort = await import('onnxruntime-node');
  const modelFile = await ensureModel(modelsDir, progress);
  progress('Finding the person…');
  const { px, w, h } = await decode(src);

  // model input: 320x320, ImageNet-normalised, CHW
  const small = await run(ffmpegPath(), ['-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-',
    '-vf', `scale=${SIZE}:${SIZE}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], undefined, Buffer.from(px));
  const input = new Float32Array(3 * SIZE * SIZE);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (small[i * 3 + c] / 255 - mean[c]) / std[c];

  const session = await ort.InferenceSession.create(modelFile);
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = result[session.outputNames[0]].data as Float32Array;
  let lo = Infinity, hi = -Infinity;
  for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }

  // upscale the mask (bilinear) and sharpen it a little: the model's edges are soft
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(SIZE - 1, Math.max(0, ((y + 0.5) * SIZE) / h - 0.5)), y0 = Math.floor(fy), y1 = Math.min(SIZE - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(SIZE - 1, Math.max(0, ((x + 0.5) * SIZE) / w - 0.5)), x0 = Math.floor(fx), x1 = Math.min(SIZE - 1, x0 + 1), tx = fx - x0;
      const v = (pred[y0 * SIZE + x0] * (1 - tx) + pred[y0 * SIZE + x1] * tx) * (1 - ty) + (pred[y1 * SIZE + x0] * (1 - tx) + pred[y1 * SIZE + x1] * tx) * ty;
      const m = (v - lo) / (hi - lo || 1);
      alpha[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, (m - 0.35) / 0.3)));
    }
  }
  for (let i = 0; i < w * h; i++) px[i * 4 + 3] = alpha[i];
  await run(ffmpegPath(), ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', '-frames:v', '1', out], undefined, Buffer.from(px));
  return { ...measure(alpha, w, h), w, h };
}
