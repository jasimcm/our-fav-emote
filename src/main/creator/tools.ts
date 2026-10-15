import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Repo root in development (dist/<x>/file.js -> ../..). */
const ROOT = path.resolve(__dirname, '..', '..');
const packaged = () => !!process.resourcesPath && __dirname.includes('app.asar');

/** ffmpeg shipped with the app (ffmpeg-static), unpacked from the asar when packaged. */
export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p: string = require('ffmpeg-static');
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

/** The Vision cut-out tool (tools/segment.swift). macOS only. */
export function segmentPath(): string {
  if (packaged()) return path.join(process.resourcesPath, 'bin', 'segment');
  const bin = path.join(ROOT, 'tools', 'bin', 'segment');
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync('swiftc', ['-O', path.join(ROOT, 'tools', 'segment.swift'), '-o', bin], { stdio: 'inherit' });
  }
  return bin;
}

export const creatorSupported = () => process.platform === 'darwin';

/** Runs a command; resolves with stdout as a Buffer. Streams stdout lines to `onLine` if given. */
export function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    let partial = '';
    child.stdout.on('data', (d: Buffer) => {
      out.push(d);
      if (!onLine) return;
      partial += d.toString();
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';
      lines.filter(Boolean).forEach(onLine);
    });
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${path.basename(cmd)} failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run(ffmpegPath(), ['-loglevel', 'error', '-y', ...args]);
