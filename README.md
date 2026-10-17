# Oru Companion

A little person who lives on your desktop and looks after you. Every so often they walk in
from the side of the screen, remind you to **drink water**, **stretch**, **rest your eyes**,
**sit up straight** or **push your code**, and walk off again once you answer.

You can turn **yourself** (or anyone who says yes) into the companion with one photo and three
AI videos.

<p align="center"><img src="docs/images/reminder.png" width="420" alt="The companion asking you to stretch"></p>

---

## Step 1: Get the app

Go to the **[Releases page](https://github.com/jasimcm/our-fav-emote/releases/latest)** and download:

| Your computer | Download | Then |
| --- | --- | --- |
| **Windows** | `Oru-Companion-Setup-….exe` | Double-click it. It installs and starts by itself. |
| Windows, no install | `Oru-Companion-…-portable.exe` | Double-click it to run it from anywhere, e.g. a USB stick. |
| **Mac** (M1 or newer) | `Oru-Companion-…-mac-arm64.dmg` | Open it and drag the app into **Applications**. |

**The first time you open it,** your computer warns you, because the app isn't signed by a paid
developer account:
- **Windows** says *"Windows protected your PC"*: click **More info**, then **Run anyway**.
- **Mac** says it *"cannot be opened"*: open **System Settings → Privacy & Security**, scroll down,
  and click **Open Anyway** next to Oru Companion.

A character walks in, says hi, and walks off. 🎉

Look for the small **person icon in the menu bar** at the top of the screen (on Windows, in the
tray by the clock; click the **^** arrow if you don't see it). Everything is in that menu.

<details>
<summary><b>Or run it from the source code</b> (for developers, or to get the newest changes)</summary>

You need [Node.js](https://nodejs.org) (LTS) and Git
([Git for Windows](https://git-scm.com/download/win); on a Mac, run `git --version` and macOS
offers to install it). Then, in Terminal on a Mac or Command Prompt (`cmd`) on Windows:

```sh
git clone https://github.com/jasimcm/our-fav-emote.git
cd our-fav-emote
npm install
npm start
```

To update later, run `git pull`, then `npm start`.
</details>

*Only for making your own character:* a **Gemini** account that can make videos (Gemini Pro makes
3 videos a day, which is exactly enough).

## Step 2: Make it yours

Menu bar icon → **Reminder settings…**

- **Your name**, so the bubble says *"Maya, time to drink some water!"*
- **Language**: English or Malayalam
- **Behaviour**: *walks in for reminders, then leaves* (default) or *stays on screen and wanders*
- **Reminders**: turn each one on or off and set how often. Press **Test** to see it now.
- **Size**, **voice** and **start when I log in**

<p align="center"><img src="docs/images/settings.png" width="300" alt="Settings window"></p>

## Step 3: Turn yourself into the companion

Menu bar icon → **Create a character from a photo…**

<p align="center"><img src="docs/images/creator.png" width="420" alt="Create a character window"></p>

**1. Choose a photo.** Type a name, tick the permission box, and pick a photo. For the best
result, the photo should show:
- your **whole body from head to shoes**, with nothing cut off
- you **standing straight, arms relaxed at your sides**, facing the camera
- good light, and nobody else in the photo

Use a **JPEG or PNG** photo. Macs also take iPhone **HEIC** photos; on Windows, send the photo from
your iPhone as JPEG (or set *Settings → Camera → Formats → Most Compatible*).

The app removes the background and gives you a clean image. Press **Save image…**

> **Windows, first time only:** the app downloads its background-removal AI model (176 MB). It's
> saved, so this happens once.

**2. Make three videos in Gemini, all in one chat.**
1. Press **Open Gemini**, start a **new chat**, choose **Video**, and attach the saved image.
2. Press **Copy prompt** under *Video 1*, paste it into Gemini, and send. When the video is ready,
   **download** it.
3. In the **same chat** (don't attach the image again), copy and send *Video 2*, then *Video 3*.
   Download each one.

**3. Add the videos.** Drop each video onto its row (or press **Choose…**), then press
**Create character**. After a minute or two you see a preview of every move. Press
**Use this character**. That's you on your desktop now. 👋

## If something looks wrong

| Problem | What to do |
| --- | --- |
| No character on the screen | The default behaviour only shows them for reminders. Use menu → **Remind me now** to call them. Also check the menu doesn't say **Resume** (paused). |
| The app says the feet or head are cut off | Use a photo with your whole body in it, from head to shoes. |
| "HEIC photos aren't supported here" (Windows) | Save or send the photo as JPEG and choose it again. |
| The photo came out on its side | Download the newest version. Phone photos are now turned the right way up automatically. |
| A move looks wrong in the preview, e.g. the wave is cut short | Ask Gemini for that video again in the same chat, then press **Create character** again. |
| The character slides or walks oddly | Regenerate video 3 (the walk). It needs a side view, walking in place. |
| Want to stop it | Menu → **Quit**. |

## Privacy

Everything runs on your own computer. The app never uploads your photo or videos: you take the
prepared image to Gemini yourself, and the videos you bring back are processed locally. Only use
photos of yourself, or of people who agreed to it.

## More

- [docs/CHARACTERS.md](docs/CHARACTERS.md): how characters work, making one by hand, and how the
  photo creator works.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): scripts, tests, building the app, and the project layout.

## Licence

MIT, see [LICENSE](LICENSE). The bundled ffmpeg binary (via
[`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)) is licensed under the GPL, so take
that into account if you distribute builds of the app.
