import fs from 'node:fs';
import path from 'node:path';
import type { CharacterManifest, ClipName } from '../../shared/types';
import {
  bestLoop, cleanup, encodeClip, findActions, measureWalk, processVideo, seconds, type Log, type Range, type VideoWork,
} from './pipeline';
import { RECIPES } from './recipes';

export interface CreateInput {
  id: string;
  name: string;
  /** Folder to write the character into (created if missing). */
  dir: string;
  videos: Partial<Record<'hello' | 'water' | 'walk', string>>;
  /** Optional trims, mostly for testing with existing footage. */
  trims?: Partial<Record<'hello' | 'water' | 'walk', { from?: number; to?: number }>>;
  log: Log;
}

export interface CreateResult {
  clips: ClipName[];
  warnings: string[];
}

/** Builds a character folder (clips + manifest.json) from the three recipe videos. */
export async function createCharacter(input: CreateInput): Promise<CreateResult> {
  const { dir, log } = input;
  fs.mkdirSync(dir, { recursive: true });
  const clips: Partial<Record<ClipName, string>> = {};
  const warnings: string[] = [];
  const sources: Record<string, unknown> = {};
  let walkSpeed = 150;

  const write = async (work: VideoWork, clip: ClipName, range: Range, opts: { fps?: number; pingpong?: boolean } = {}) => {
    const file = `${clip}.webm`;
    await encodeClip(work, path.join(dir, file), range, opts);
    clips[clip] = file;
    sources[clip] = { video: work.label, range: seconds(range), ...opts };
    log(`made ${clip} (${seconds(range)}${opts.pingpong ? ', ping-pong loop' : ''})`);
  };

  for (const recipe of RECIPES) {
    const src = input.videos[recipe.id];
    if (!src) {
      warnings.push(`No ${recipe.id} video, so ${recipe.makes.join(', ')} will use fallbacks.`);
      continue;
    }
    const work = await processVideo(src, { label: recipe.id, walk: recipe.id === 'walk', ...input.trims?.[recipe.id] }, log);
    try {
      if (recipe.id === 'walk') {
        // skip any turning at the start: search the steady second half first, then the whole clip
        const half: Range = [Math.floor(work.count * 0.35), work.count];
        let loop = bestLoop(work, half, 1.5, 4);
        if (loop.seam > 6) loop = bestLoop(work, [0, work.count], 1.5, 4);
        if (loop.seam > 8) warnings.push('The walk loop has a visible jump. Try regenerating the walk video.');
        const walk = await measureWalk(work, loop.range);
        walkSpeed = walk.speed;
        log(`walk speed ${walkSpeed}px/s, facing ${walk.facing}`);
        // save it under the direction they actually face; the other direction is mirrored
        await write(work, walk.facing === 'left' ? 'walk_left' : 'walk_right', loop.range);
        continue;
      }

      const wanted = recipe.makes.filter((c) => c !== 'idle');
      const { actions, rests, split } = findActions(work, wanted.length);
      if (split) warnings.push(`${recipe.id}: the actions ran into each other, so they were split at the calmest moment. Check them.`);
      if (actions.length < wanted.length) {
        warnings.push(`${recipe.id}: found ${actions.length} of ${wanted.length} actions (${wanted.join(', ')}).`);
      }
      for (let i = 0; i < Math.min(actions.length, wanted.length); i++) await write(work, wanted[i], actions[i]);

      if (recipe.makes.includes('idle')) {
        // idle = the longest rest stretch, played forward then backward (seamless), at 12fps
        const rest = rests.reduce<Range | null>((a, r) => (!a || r[1] - r[0] > a[1] - a[0] ? r : a), null);
        if (rest && rest[1] - rest[0] >= 12) {
          const len = Math.min(rest[1] - rest[0], 48);
          const mid = Math.floor((rest[0] + rest[1]) / 2);
          await write(work, 'idle', [mid - Math.floor(len / 2), mid + Math.ceil(len / 2)], { fps: 12, pingpong: true });
        } else {
          warnings.push('No still moment long enough for idle. The video should start and end standing still.');
        }
      }
    } finally {
      cleanup(work);
    }
  }

  if (!clips.idle) throw new Error("Couldn't make the idle clip, which every character needs. Add the Hello video.");

  const manifest: CharacterManifest = {
    name: input.name,
    author: 'Made from a photo with Oru Companion',
    height: 340,
    walkSpeed,
    clips,
    lines: {},
    voices: {},
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ videos: input.videos, clips: sources }, null, 2) + '\n');
  return { clips: Object.keys(clips) as ClipName[], warnings };
}
