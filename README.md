# Oru Companion

A desktop companion for macOS and Windows. A character lives on top of your desktop: it walks
along the bottom of the screen just above the taskbar, idles, waves, sits down, falls
asleep, follows your cursor, and pops up speech bubbles that remind you to drink water,
stretch, rest your eyes, fix your posture and push your code.

It ships with a **placeholder** cartoon character that has every clip, so it works out of the
box. Then **make your own**: turn one full-body photo of yourself into a hyperrealistic
companion with three AI videos (see [Create a character from a photo](#create-a-character-from-a-photo-macos)).

## Run it

You need [Node.js](https://nodejs.org) 20 or newer and git. Making characters from photos needs
macOS (it uses Apple's Vision framework); the companion itself also runs on Windows.

```sh
git clone https://github.com/jasimcm/oru-companion.git
cd oru-companion
npm install
npm start
```

A little person walks in from the side, says hi, and walks off. From then on they **visit**:
when a reminder is due they walk in to the middle of the screen, ask, and after you answer
they walk off the other side. Prefer company all the time? Settings → **Behaviour** →
*Stays on screen and wanders*.

Everything else is in the menu bar (or tray) icon: **Pause**, **Switch character**,
**Reminder settings…**, **Create a character from a photo…**, **Remind me now**, **Quit**.
Set your name in Settings, and the bubbles will say *"<your name>, time to drink some water!"*.

| Script | What it does |
| --- | --- |
| `npm start` | Build and run |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | Scripted end-to-end check (reminder → Yes → log, Malayalam, snooze, settings). Uses a throwaway data folder and saves captures of the app's own windows in `.smoke/` |
| `npm run placeholders` | Regenerate the placeholder character |
| `npm run dist:mac` | Build `release/Oru Companion-<version>-arm64.dmg` and `.zip` (unsigned, so right-click → Open the first time) |
| `npm run dist:win` | Build `release/Oru Companion Setup.exe` and a portable `.exe` (run this on Windows; from a Mac use `npx electron-builder --win zip`) |
| `node dist/cli/oru.js …` | Character tools on the command line (macOS): `prepare-photo`, `create`, `import-clip`, `analyze`; see below |

## Create a character from a photo (macOS)

Menu bar icon → **Create a character from a photo…** (or Settings → Character). Anyone can turn
one full-body photo into their own companion. It takes **three Gemini videos**, which is a Gemini
Pro plan's daily limit, so every video packs several emotes:

| Video | The prompt asks for | Cut into |
| --- | --- | --- |
| 1. Hello | still → wave → still → laugh → still | `idle`, `wave`, `laugh` |
| 2. Water | still → raise bottle & point ("drink water!") → still → sip → still | `water_ask`, `drink_water` |
| 3. Walk | side view, walking in place | `walk_right` (+ mirrored `walk_left`) |

1. **Photo:** the app cuts the person out and places them, whole body and centred, on a plain
   backdrop. The colour is chosen to differ from their clothes (blue, green or magenta), so
   removing it later can't eat into them. It warns if the head, feet or hands are cut off.
   Save the image.
2. **Gemini:** upload that image, paste each prompt (Copy buttons in the window), download the
   three videos.
3. **Videos:** drop them in and press **Create character**. The app finds the rest moments
   between actions and cuts there. Idle is a still stretch played forward and back, so it
   loops seamlessly. The walk loop and `walkSpeed` are found automatically. You get a preview
   of every clip, then **Use this character**.

Characters made this way are saved in the user characters folder with the prepared photo.
Missing videos are fine: their emotes use fallbacks. A consent checkbox ("this is me, or I have
their permission") is required before a photo can be used.

The same thing from the terminal:

```sh
npm run build
node dist/cli/oru.js prepare-photo photo.jpg for-gemini.png
node dist/cli/oru.js create --id maya --name "Maya" --hello hello.mp4 --water water.mp4 --walk walk.mp4
```

## Privacy

Everything runs on your computer. The app never uploads your photo or videos: you take the
prepared image to Gemini yourself, and the videos you bring back are processed locally.
Settings, the reminder log and your characters stay in the app's data folder.

## What it does

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

## Adding a character

A character is a folder containing a `manifest.json` and WebM clips. Put it in the
**user characters folder** (Settings → *Open characters folder…*, which is
`%APPDATA%\Oru Companion\characters\`), or in `characters/` in this repo to bundle it with the app.
The folder name is the character's id. A user folder with the same id as a bundled one
overrides it.

```
characters/
  chettan/
    manifest.json
    idle.webm
    walk_right.webm
    walk_left.webm        (optional, walk_right is mirrored if missing)
    wave.webm
    drink_water.webm
    point.webm
    sit.webm
    sleep.webm
    laugh.webm
    think.webm
    surprised.webm
    voice/
      water_ml.mp3        (optional)
```

### manifest.json

```jsonc
{
  "name": "Chettan",
  "author": "you",
  "height": 320,          // on-screen height in px at 100% size
  "walkSpeed": 180,       // how far the feet travel per second, in px of the CLIP's own resolution
  "clips": {
    "idle": "idle.webm",
    "walk_right": "walk_right.webm",
    "walk_left": "walk_left.webm",
    "wave": "wave.webm",
    "water_ask": "water_ask.webm",
    "drink_water": "drink_water.webm",
    "point": "point.webm",
    "sit": "sit.webm",
    "sleep": "sleep.webm",
    "laugh": "laugh.webm",
    "think": "think.webm",
    "surprised": "surprised.webm"
  },
  // optional: which clips loop (this is the default)
  "loop": ["idle", "walk_left", "walk_right", "sit", "sleep"],
  // optional: which clip plays when a reminder appears, and after "Yes"
  "reminderClips": { "posture": { "ask": "point", "yes": "laugh" } },
  // optional: line packs per language. {name} is replaced with the user's name
  "lines": {
    "en": { "water": { "text": "{name}, time to drink some water! 💧", "yes": "YES", "thanks": "Adipoli! 😄" } },
    "ml": { "water": { "text": "{name}, വെള്ളം കുടിക്കാൻ സമയമായി! 💧" } }
  },
  // optional: pre-recorded voice lines (played when voice is on; otherwise text-to-speech is used)
  "voices": { "ml": { "water": "voice/water_ml.mp3" } }
}
```

Reminder ids are `water`, `stretch`, `eyes`, `posture` and `push`. Anything you leave out
falls back to the built-in English and Malayalam lines.

Only `idle` is strictly required. Missing clips fall back (`water_ask` → `wave`,
`drink_water` → `laugh` → `wave`, `point` → `wave`, `surprised` → `think`, anything else → `idle`),
and random states whose clip is missing (sit, sleep, think, laugh) are simply skipped. Settings
lists what each character still lacks.

### Clip rules

1. **Format:** WebM, **VP9 with alpha** (`yuva420p`). Encode with:
   ```sh
   ffmpeg -framerate 24 -i frames/%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p \
     -b:v 0 -crf 30 -row-mt 1 -auto-alt-ref 0 idle.webm
   ```
   To check it worked: `ffprobe idle.webm` should show `alpha_mode : 1`.
2. **Same canvas for every clip.** All clips must have the same width and height, with the
   character centred horizontally and feet on the bottom edge. Otherwise the character
   jumps when clips swap. Crop tightly: the transparent area still blocks clicks.
3. **Walk clips walk in place.** The app moves the character across the screen, so the
   person must stay centred in the frame, as if on a treadmill.
4. **`walkSpeed` stops foot sliding.** Measure how far a planted foot moves backwards in
   one second of `walk_right`, in clip pixels. For example: the foot moves 90 px over 12
   frames at 24 fps, so it moves 180 px per second. Put that number in the manifest. The
   app scales it to the on-screen size.
5. **Direction:** `walk_right` faces right and `walk_left` faces left. Directional one-shot
   clips (`point`, `wave`, `surprised`, ...) should face **right**; the app mirrors them when
   the character faces left.
6. **Loops must loop cleanly.** The first and last frames of `idle`, `walk_*`, `sit` and
   `sleep` should match. One-shot clips should start and end close to the idle pose so the
   120 ms crossfade hides the swap.
7. **CPU:** VP9 with alpha is decoded in software. Encode looping still states (`idle`,
   `sit`, `sleep`) at **12 fps**, which halves the decoding cost, and keep walk and action
   clips at 24 fps. Keep the frame height around 480–720 px.

### Making a hyperrealistic character by hand (macOS)

For full control over each clip (any source video, any trim), import clips one at a time:

```sh
npm run build
node dist/cli/oru.js import-clip --char maya --clip idle --src sources/maya/idle.mp4 --loop 4:9 --fps 12
node dist/cli/oru.js import-clip --char maya --clip walk_right --src sources/maya/walk.mp4 --walk --loop 1.5:4
node dist/cli/oru.js import-clip --char maya --clip wave --src sources/maya/wave.mp4 --from 2 --to 5.5
```

The pipeline (`src/main/creator/pipeline.ts`, shared with the in-app creator):

1. **Cut-out:** macOS Vision (`tools/segment.swift`) finds the person and keeps only the
   largest subject, which drops watermarks. Backdrop showing through gaps (between arm and
   body) and colour spill on the edges are cleaned by comparing colours against the backdrop,
   which is sampled from the frame border. Brightness is ignored, so vignetting doesn't matter.
2. **Same canvas:** every clip is scaled so the person is the same height (580 px), with the
   feet on the same line, on a 400×640 canvas.
3. **Walk in place:** `--walk` removes any sideways drift and measures `walkSpeed` from how
   fast the planted foot slides back.
4. **Loop:** `--loop a:b` finds the start and end frames that match best.
5. **Encode:** VP9 with alpha, using the bundled ffmpeg (`ffmpeg-static`); the clip is added to
   `manifest.json`.

Each character's `import.sh` rebuilds all its clips. Source videos live in `sources/` (git-ignored).

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

## Licence

MIT, see [LICENSE](LICENSE). The bundled ffmpeg binary (via
[`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)) is licensed under the GPL, so take
that into account if you distribute builds of the app.
