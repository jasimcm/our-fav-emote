# Development

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Build and run |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | Scripted end-to-end check (reminder → Yes → log, Malayalam, snooze, settings). Uses a throwaway data folder and saves captures of the app's own windows in `.smoke/` |
| `npm run placeholders` | Regenerate the placeholder character |
| `npm run dist:mac` | Build `release/Oru Companion-<version>-arm64.dmg` and `.zip` (unsigned, so right-click → Open the first time) |
| `npm run dist:win` | Build `release/Oru Companion Setup.exe` and a portable `.exe` (run this on Windows; from a Mac use `npx electron-builder --win zip`) |
| `node dist/cli/oru.js …` | Character tools on the command line (macOS): `prepare-photo`, `create`, `import-clip`, `analyze`; see [CHARACTERS.md](CHARACTERS.md) |

The smoke test can also drive the character creator: set `ORU_SMOKE_CREATOR` to a folder containing
`photo.jpg`, `hello.mp4` and `walk.mp4`. Add `ORU_PORTABLE=1` to test the Windows/Linux background
removal on a Mac.

**Building the Windows app:** run `npm install` and `npm run dist:win` **on Windows**, so the bundled
ffmpeg and onnxruntime binaries are the Windows ones.

## How it works

- **One transparent, always-on-top window** covering the work area of the display, so the
  ground is the top edge of the taskbar. Clicks pass through everywhere except the
  character and the speech bubble.
- **Character engine:** a weighted random state machine (idle → walk → idle → wave / laugh /
  think / sit / sleep, 4–12 s per state). Sometimes it walks over to your cursor and points
  at it. It moves at the speed given in the manifest, so the feet don't slide.
- **One `<video>` element:** clips are swapped on the same element. A 120 ms crossfade comes
  from a canvas snapshot of the last frame, so there are no visible cuts. All clips are
  preloaded into memory when a character loads.
- **Drag** the character to pick it up. It plays `surprised`, falls back to the ground
  when you let go, then goes back to idle. A click without dragging makes it laugh.
- **Pauses automatically** when a fullscreen app, game or presentation is in front. On Windows
  this uses the system's own "busy / fullscreen" signal (`SHQueryUserNotificationState`), and
  reminders wait in a queue. On macOS the overlay simply isn't shown on fullscreen Spaces.
- **macOS:** no Dock icon. A template icon in the menu bar adapts to light and dark mode. The
  character stands on top of the Dock and appears on every Space.
- **Multiple monitors:** the window follows the display your cursor is on.
- **Reminders:** water (45 min), stretch (60), eyes 20-20-20 (20), posture (30) and
  push your code (90). Each bubble has **Yes** and **Remind me later**. Yes plays the
  matching clip (water → `drink_water`) and writes a line to `reminder-log.jsonl`.
  Remind me later snoozes for 10 minutes. The bubble uses your name from settings.
- **Settings window:** name, language (English / Malayalam), character, size (50–150%),
  voice on/off, volume, every reminder's interval and on/off switch, snooze length,
  start on login, and today's water count.

Settings and the reminder log live in the app's data folder:
`%APPDATA%\Oru Companion\` on Windows, or `~/Library/Application Support/Oru Companion/` on macOS.

## Project layout

```
src/main/         Electron main process
  main.ts         windows, tray, IPC, pause logic, display following
  creator/        photo → character: photo prep, recipes (the 3 prompts), video pipeline, creator window
  characters.ts   character discovery + the oru:// protocol that serves pages and clips
  reminders.ts    timers, snooze, line packs, the Yes log
  fullscreen.ts   Windows fullscreen/game detection
  settings.ts     settings file
  dev.ts          ORU_DEBUG / ORU_SMOKE development aids
src/preload/      the window.oru bridge
src/renderer/     overlay (character engine + speech bubble) and settings window
src/cli/          command-line character tools (dist/cli/oru.js)
src/shared/       types shared by all of the above
scripts/          build, placeholder generator, smoke test runner
tools/            segment.swift (macOS Vision cut-out), compiled to tools/bin/
characters/       bundled characters (placeholder)
sources/          raw source videos (git-ignored)
```
