// Builds public test media for the character creator from the placeholder character, so the
// creator can be tested anywhere (CI included) without anyone's real photo or videos:
//   photo.jpg  the character on a busy background (the photo step must cut it out)
//   hello.mp4  still -> wave -> still -> laugh -> still, on a plain blue backdrop (like Gemini's)
//   walk.mp4   walking in place, on the same backdrop
// Usage: node scripts/make-test-media.mjs <outDir>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const out = path.resolve(process.argv[2] ?? '.smoke-media');
const C = path.resolve('characters/placeholder');
fs.mkdirSync(out, { recursive: true });
const ff = (...args) => execFileSync(ffmpeg, ['-loglevel', 'error', '-y', ...args]);
const BACKDROP = 'color=c=0x2a6fd6:s=1280x720:r=24';
// the placeholder clips are 360x480 with transparency; place them like a person in a video
const person = (input) => ['-c:v', 'libvpx-vp9', ...input];
const overlay = '[1]scale=-2:600[p];[0][p]overlay=x=(W-w)/2:y=H-h-30:shortest=1';

// hello: idle 1.5s, wave, idle 1.2s, laugh, idle 1.5s
const parts = [['idle', 1.5], ['wave'], ['idle', 1.2], ['laugh'], ['idle', 1.5]];
const segs = parts.map(([clip, secs], i) => {
  const seg = path.join(out, `seg${i}.mp4`);
  ff('-f', 'lavfi', '-i', BACKDROP, ...person(secs ? ['-stream_loop', '-1', '-i', path.join(C, `${clip}.webm`)] : ['-i', path.join(C, `${clip}.webm`)]),
    '-filter_complex', overlay, ...(secs ? ['-t', String(secs)] : []), '-r', '24', '-pix_fmt', 'yuv420p', seg);
  return seg;
});
fs.writeFileSync(path.join(out, 'list.txt'), segs.map((s) => `file '${s.replaceAll("'", "'\\''")}'`).join('\n'));
ff('-f', 'concat', '-safe', '0', '-i', path.join(out, 'list.txt'), '-c', 'copy', path.join(out, 'hello.mp4'));
segs.forEach((s) => fs.rmSync(s));
fs.rmSync(path.join(out, 'list.txt'));

// walk: 6s walking in place
ff('-f', 'lavfi', '-i', BACKDROP, ...person(['-stream_loop', '-1', '-i', path.join(C, 'walk_right.webm')]),
  '-filter_complex', overlay, '-t', '6', '-r', '24', '-pix_fmt', 'yuv420p', path.join(out, 'walk.mp4'));

// photo: the character standing in front of a plain-ish wall, like a real photo (the photo step must find them)
ff('-f', 'lavfi', '-i', 'gradients=s=1280x960:c0=0xd9cfc2:c1=0x7d7266:x0=0:y0=0:x1=1280:y1=960:duration=1,noise=alls=10:allf=t', ...person(['-i', path.join(C, 'idle.webm')]),
  '-filter_complex', '[1]scale=-2:820[p];[0][p]overlay=x=(W-w)/2:y=H-h-40', '-frames:v', '1', '-q:v', '3', path.join(out, 'photo.jpg'));

console.log(`test media written to ${out}`);
