import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIP_NAMES, type CharacterInfo, type CharacterManifest, type CharacterSummary } from '../shared/types';

export const SCHEME = 'oru';

/** Bundled characters ship with the app; user characters live in userData. */
export function characterRoots(): string[] {
  return [path.join(app.getAppPath(), 'characters'), userCharactersDir()];
}

export function userCharactersDir(): string {
  const dir = path.join(app.getPath('userData'), 'characters');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findCharacterDir(id: string): string | null {
  // later roots win, so a user folder can override a bundled one with the same id
  for (const root of [...characterRoots()].reverse()) {
    const dir = path.join(root, id);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

export function listCharacters(): CharacterSummary[] {
  const seen = new Map<string, CharacterManifest>();
  for (const root of characterRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const id of fs.readdirSync(root)) {
      const m = readManifest(path.join(root, id));
      if (m) seen.set(id, m);
    }
  }
  // one walk direction is enough: the other is mirrored
  const optional = (m: CharacterManifest, c: string) =>
    (c === 'walk_left' && m.clips.walk_right) || (c === 'walk_right' && m.clips.walk_left);
  return [...seen].map(([id, m]) => ({
    id,
    name: m.name,
    missing: CLIP_NAMES.filter((c) => !m.clips[c] && !optional(m, c)),
  }));
}

function readManifest(dir: string): CharacterManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function loadCharacter(id: string): CharacterInfo | null {
  const dir = findCharacterDir(id);
  const manifest = dir && readManifest(dir);
  if (!manifest) return null;
  return { id, baseUrl: `${SCHEME}://app/char/${encodeURIComponent(id)}/`, manifest };
}

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/**
 * One origin for everything, so fetch() works without CORS:
 *   oru://app/<file>             -> dist/renderer/<file>
 *   oru://app/char/<id>/<file>   -> the character's folder
 */
export function handleScheme(rendererDir: string): void {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let dir: string | null = rendererDir;
    if (parts[0] === 'char') {
      dir = parts[1] ? findCharacterDir(parts[1]) : null;
      parts.splice(0, 2);
    }
    if (url.host !== 'app' || !dir) return new Response('not found', { status: 404 });
    const file = path.resolve(dir, ...parts);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}
