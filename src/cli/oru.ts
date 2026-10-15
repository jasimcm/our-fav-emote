// Command-line access to the character creator (macOS).
//   node dist/cli/oru.js prepare-photo <photo> <out.png>
//   node dist/cli/oru.js create --id maya --name "Maya" --hello a.mp4 --water b.mp4 --walk c.mp4
//   node dist/cli/oru.js import-clip --char maya --clip idle --src x.mp4 [--from s] [--to s] [--fps 12] [--loop 4:9] [--walk]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { CharacterManifest, ClipName } from '../shared/types';
import { createCharacter } from '../main/creator/create';
import { preparePhoto } from '../main/creator/photo';
import { bestLoop, cleanup, encodeClip, FPS, measureWalkSpeed, processVideo, seconds, type Range } from '../main/creator/pipeline';

const ROOT = path.resolve(__dirname, '..', '..');
const log = (m: string) => console.log(`  ${m}`);
const [cmd, ...rest] = process.argv.slice(2);
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

async function main(): Promise<void> {
  if (cmd === 'prepare-photo') {
    const [src, out] = rest;
    const r = await preparePhoto(path.resolve(src), path.resolve(out));
    console.log(`wrote ${r.image}`);
    r.warnings.forEach((w) => console.log(`warning: ${w}`));
    return;
  }

  if (cmd === 'create') {
    const { values: a } = parseArgs({
      args: rest,
      options: Object.fromEntries(
        ['id', 'name', 'out', 'hello', 'water', 'walk', 'hello-from', 'hello-to', 'water-from', 'water-to', 'walk-from', 'walk-to']
          .map((k) => [k, { type: 'string' as const }]),
      ),
    });
    if (!a.id) throw new Error('--id is required');
    const trim = (k: string) => ({ from: num(a[`${k}-from`]), to: num(a[`${k}-to`]) });
    const r = await createCharacter({
      id: a.id,
      name: a.name ?? a.id,
      dir: path.resolve(a.out ?? path.join(ROOT, 'characters', a.id)),
      videos: { hello: a.hello, water: a.water, walk: a.walk },
      trims: { hello: trim('hello'), water: trim('water'), walk: trim('walk') },
      log,
    });
    console.log(`clips: ${r.clips.join(', ')}`);
    r.warnings.forEach((w) => console.log(`warning: ${w}`));
    return;
  }

  if (cmd === 'import-clip') {
    const { values: a } = parseArgs({
      args: rest,
      options: {
        char: { type: 'string' }, clip: { type: 'string' }, src: { type: 'string' }, from: { type: 'string' },
        to: { type: 'string' }, fps: { type: 'string' }, loop: { type: 'string' }, walk: { type: 'boolean' },
      },
    });
    if (!a.char || !a.clip || !a.src) throw new Error('--char, --clip and --src are required');
    const dir = path.join(ROOT, 'characters', a.char);
    fs.mkdirSync(dir, { recursive: true });
    const work = await processVideo(path.resolve(a.src), { label: a.clip, walk: a.walk, from: num(a.from), to: num(a.to) }, log);
    try {
      let range: Range = [0, work.count];
      if (a.loop) {
        const [lo, hi] = a.loop.split(':').map(Number);
        const l = bestLoop(work, range, lo, hi);
        range = l.range;
        log(`loop ${seconds(range)} (seam ${l.seam.toFixed(2)})`);
      }
      const mPath = path.join(dir, 'manifest.json');
      const m: CharacterManifest = fs.existsSync(mPath)
        ? JSON.parse(fs.readFileSync(mPath, 'utf8'))
        : { name: a.char, height: 340, walkSpeed: 150, clips: {} };
      if (a.walk) {
        m.walkSpeed = await measureWalkSpeed(work, range);
        log(`walk speed ${m.walkSpeed}px/s`);
      }
      const file = `${a.clip}.webm`;
      await encodeClip(work, path.join(dir, file), range, { fps: num(a.fps) ?? FPS });
      m.clips[a.clip as ClipName] = file;
      fs.writeFileSync(mPath, JSON.stringify(m, null, 2) + '\n');
      console.log(`wrote characters/${a.char}/${file} (${seconds(range)})`);
    } finally {
      cleanup(work);
    }
    return;
  }

  if (cmd === 'analyze') {
    // debug: per-frame silhouette width, motion and distance from the first frame
    const [src, from, to] = rest;
    const work = await processVideo(path.resolve(src), { label: 'analyze', from: num(from), to: num(to) }, () => {});
    const { thumbs } = work;
    const width = (t: Uint8Array) => { let c = 0; for (let x = 0; x < 40; x++) { for (let y = 0; y < 64; y++) if (t[y * 40 + x] > 128) { c++; break; } } return c; };
    const diff = (a: Uint8Array, b: Uint8Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    for (let i = 0; i < work.count; i += 6) {
      const m = i >= 2 ? diff(thumbs[i], thumbs[i - 2]) : 0;
      console.log(`${(i / FPS).toFixed(2)}s  width ${String(width(thumbs[i])).padStart(2)}  motion ${m.toFixed(1).padStart(5)}  fromStart ${diff(thumbs[i], thumbs[0]).toFixed(1).padStart(5)}`);
    }
    cleanup(work);
    return;
  }

  console.log('usage: oru <prepare-photo|create|import-clip|analyze> ...  (see src/cli/oru.ts)');
  process.exit(1);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
