// Runs the scripted smoke test (see src/main/dev.ts). Captures land in .smoke/
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const dir = path.resolve('.smoke');
rmSync(dir, { recursive: true, force: true });
// creator test inputs (optional): a folder with photo.jpg, hello.mp4, walk.mp4
const creator = process.env.ORU_SMOKE_CREATOR ?? '';
const r = spawnSync(electron, ['.'], { stdio: 'inherit', env: { ...process.env, ORU_SMOKE: dir, ORU_SMOKE_CREATOR: creator } });
process.exit(r.status ?? 1);
