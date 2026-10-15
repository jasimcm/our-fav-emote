# Characters

How characters work, how to make one by hand, and how the automatic pipeline works.
For the easy way (one photo + three Gemini videos), see the [README](../README.md).

## Character folders

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

## How "Create a character from a photo" works

Code: `src/main/creator/` (`photo.ts`, `recipes.ts`, `pipeline.ts`, `create.ts`). The same thing
from the terminal:

```sh
npm run build
node dist/cli/oru.js prepare-photo photo.heic for-gemini.png
node dist/cli/oru.js create --id maya --name "Maya" --hello hello.mp4 --water water.mp4 --walk walk.mp4
```

**Background removal, per platform:**

| | macOS | Windows / Linux |
| --- | --- | --- |
| Photo (any background) | Apple Vision (`tools/segment.swift`) | [U²-Net human segmentation](https://github.com/xuebinqin/U-2-Net) (Apache-2.0) via `onnxruntime-node`, `photo-ml.ts`. The 176 MB model is downloaded once to the app's data folder and checked against its SHA-256 |
| Videos (our plain backdrop) | Apple Vision + backdrop clean-up | Colour-difference key, `keyer.ts`: backdrop sampled from the frame border, hue-only distance (shadows and vignetting key out), largest shape kept (drops watermarks), edge tint removed |

Set `ORU_PORTABLE=1` to use the Windows/Linux path on a Mac (for testing).

1. **Photo:** the photo is read with its camera rotation applied (iPhone photos are stored
   sideways with a rotate tag). The person is cut out and placed, whole body and centred, on a
   plain 1280×720 backdrop. The colour (blue, green or magenta) is the one least like their
   clothes, so removing it later can't eat into them. Warnings are shown if the head, feet or
   hands touch the edge.
2. **Three videos, one Gemini chat** (`recipes.ts`): the photo is attached once with prompt 1, and
   prompts 2 and 3 refer back to "the same person". Each video packs several emotes and asks for
   a return to the same relaxed pose between them:

   | Video | The prompt asks for | Cut into |
   | --- | --- | --- |
   | 1. Hello | still → wave → still → laugh → still | `idle`, `wave`, `laugh` |
   | 2. Water | still → raise bottle & point → still → sip → still | `water_ask`, `drink_water` |
   | 3. Walk | side view, walking in place | `walk_right` or `walk_left` |

3. **Cutting:** each video's frames go onto the shared canvas (see the pipeline below). The
   *rest pose* is the opening/closing pose if they match, otherwise the narrowest silhouette
   (arms at the sides). Frames far from it are actions, which are assigned in prompt order. Idle
   is the longest rest stretch played forward then backward, so it loops seamlessly.
4. **Walking:** the loop is taken from the steady part of the walk, and the planted foot gives
   the speed *and* the direction the person faces: a foot sliding left means they face right.
   The clip is saved under that direction, and the other one is mirrored, so the character never
   moonwalks even when Gemini faces the "wrong" way.
