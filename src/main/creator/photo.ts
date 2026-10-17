import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEY_TO } from './keyer';
import { cutOutPhoto } from './photo-ml';
import { ffmpeg, ffmpegPath, run, segmentPath, useVision } from './tools';

export interface PreparedPhoto {
  /** 1280x720 image to upload to Gemini: the person, centred, on a plain backdrop. */
  image: string;
  /** Backdrop colour chosen to contrast with the person's clothes. */
  backdrop: string;
  warnings: string[];
}

/** Plain backdrops to choose from; the one least like the person's own colours wins. */
const BACKDROPS = [
  { name: 'blue', hex: '0x2a6fd6', rgb: [42, 111, 214] },
  { name: 'green', hex: '0x2fb34a', rgb: [47, 179, 74] },
  { name: 'magenta', hex: '0xc23ad1', rgb: [194, 58, 209] },
] as const;

// same opponent-colour measure as tools/segment.swift (brightness ignored)
const chroma = (r: number, g: number, b: number) => [b - (r + g) / 2, g - r];

/** Share of the person's pixels the backdrop clean-up would mistake for each backdrop. */
async function pickBackdrop(cutout: string): Promise<(typeof BACKDROPS)[number]> {
  const raw = await run(ffmpegPath(), ['-loglevel', 'error', '-i', cutout, '-vf', 'scale=120:-2', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
  const scored = BACKDROPS.map((bd) => {
    const [bc, bg] = chroma(bd.rgb[0], bd.rgb[1], bd.rgb[2]);
    const mag = Math.hypot(bc, bg);
    let near = 0, total = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 200) continue;
      total++;
      const [c, g] = chroma(raw[i], raw[i + 1], raw[i + 2]);
      if (Math.hypot(c - bc, g - bg) < KEY_TO * mag) near++; // would be (partly) keyed out
    }
    return { bd, share: total ? near / total : 1 };
  });
  return scored.sort((a, b) => a.share - b.share)[0].bd;
}

/**
 * Cuts the person out of any photo and places them, whole body, on a plain 16:9 backdrop in a
 * colour unlike their clothes (so removing it later can't eat into them).
 * Starting every video from this same clean image keeps the person consistent across videos
 * and makes the background easy to remove afterwards.
 */
export async function preparePhoto(
  src: string, out: string, opts: { modelsDir: string; progress?: (msg: string) => void },
): Promise<PreparedPhoto> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oru-photo-'));
  const inDir = path.join(dir, 'in'), cutDir = path.join(dir, 'cut');
  fs.mkdirSync(inDir);
  try {
    let stat: { w: number; h: number; box: number[] | null };
    if (useVision()) {
      // the original file goes straight to the cut-out tool, which reads HEIC/JPEG/PNG and applies
      // the camera's rotation tag (iPhone photos are stored sideways with "rotate 90°")
      const ext = path.extname(src).toLowerCase() || '.jpg';
      fs.copyFileSync(src, path.join(inDir, `00001${ext}`));
      await run(segmentPath(), ['--raw', inDir, cutDir]); // the photo's own background can be anything
      stat = JSON.parse(fs.readFileSync(path.join(cutDir, 'stats.jsonl'), 'utf8').trim().split('\n')[0]);
    } else {
      fs.mkdirSync(cutDir);
      stat = await cutOutPhoto(src, path.join(cutDir, '00001.png'), opts.modelsDir, opts.progress ?? (() => {}));
    }
    if (!stat.box) throw new Error("Couldn't find a person in this photo.");
    const [x0, y0, x1, y1] = stat.box as number[];
    const iw: number = stat.w, ih: number = stat.h; // upright size

    const warnings: string[] = [];
    if (y0 <= 2) warnings.push('The top of the head touches the edge of the photo. It may be cut off.');
    if (y1 >= ih - 3) warnings.push('The feet touch the bottom edge. Use a photo that shows the whole body, including shoes.');
    if (x0 <= 2 || x1 >= iw - 3) warnings.push('The person touches the side of the photo. Arms or hands may be cut off.');
    if (y1 - y0 < 500) warnings.push('The person is small in this photo, so the result may look soft. A higher-resolution photo works better.');
    if ((y1 - y0) / (x1 - x0) < 1.6) warnings.push("This doesn't look like a standing full-body photo.");

    const backdrop = await pickBackdrop(path.join(cutDir, '00001.png'));
    const h = 600, feetY = 690;
    await ffmpeg([
      '-f', 'lavfi', '-i', `color=c=${backdrop.hex}:s=1280x720`, '-i', path.join(cutDir, '00001.png'),
      '-filter_complex', `[1]crop=${x1 - x0 + 1}:${y1 - y0 + 1}:${x0}:${y0},scale=-2:${h}:flags=lanczos[p];[0][p]overlay=x=(W-w)/2:y=${feetY - h}`,
      '-frames:v', '1', out,
    ]);
    return { image: out, backdrop: backdrop.name, warnings };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
