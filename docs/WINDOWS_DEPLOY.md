# Deploy on a Windows PC — step by step

This guide takes a clean Windows 10 or 11 PC and ends with **AI Video Creator** running and rendering MP4s.

Three ways to install:

- **A. One-click batch scripts** — fastest possible setup. Just `setup.bat` once, then `start.bat` forever after.
- **B. Built installer** — if you already have a packaged `.exe`.
- **C. Build from source manually** — for development, if you want to control every step.

If you've never touched this project on this machine and just want it working, **use Option A**. If something there fails, fall back to section 1 (prerequisites) + the manual flow.

---

## Option A — one-click batch scripts (recommended)

1. Install **Git** from <https://git-scm.com/download/win> (defaults are fine).
2. Open **PowerShell** in a folder where you want the source:
   ```powershell
   cd C:\dev
   git clone https://github.com/KavinduGM/heygen_video_tool.git
   cd heygen_video_tool
   ```
3. Double-click **`setup.bat`** in File Explorer.
   - It checks for Node.js and installs it via `winget` if missing.
   - Runs `npm install` and rebuilds native modules.
   - Installs the Hyperframes CLI skill.
   - If it installs Node.js, it will tell you to close the window and re-run — do that.
4. Double-click **`start.bat`** to launch the app. Keep that console window open while you use the app — closing it kills the app.
5. (Optional) Right-click `start.bat` → *Create shortcut*, drag the shortcut to your Desktop or pin it to Start.

Skip to **section 4 — first-run setup** to configure API keys and voice profiles.

---

## 1. Prerequisites (one-time)

These are needed whether you install from a built `.exe` or build from source — both rely on `npx hyperframes`, which needs Node.js.

### 1.1 Install Node.js LTS

1. Open <https://nodejs.org/> in your browser.
2. Click the **LTS** download (currently 20.x or newer).
3. Run the `.msi`. Accept all defaults. ✅ Leave "Add to PATH" checked.
4. Restart any open PowerShell / Command Prompt windows.
5. Verify:

   Open **PowerShell** and run:
   ```powershell
   node --version
   npm  --version
   npx  --version
   ```
   All three should print a version number.

### 1.2 Install Git (only if you'll build from source)

1. Download from <https://git-scm.com/download/win>.
2. Run the installer with all defaults.
3. Verify in PowerShell: `git --version`.

### 1.3 Install the Hyperframes CLI

In PowerShell run:

```powershell
npx skills add heygen-com/hyperframes
```

This installs HeyGen's Hyperframes skill globally so `npx hyperframes …` works from anywhere. The first time you run any `npx hyperframes` command it may download a headless Chromium — give it a minute.

Verify:

```powershell
npx hyperframes --help
```

### 1.4 (Optional) Add Windows Defender exclusions

Electron apps spawn `ffmpeg.exe`, `node.exe`, and a headless browser many times — Defender's real-time scanning can slow rendering by 5–10×. If you'll render long videos, add an exclusion for:

- `C:\Users\<you>\AppData\Roaming\AI Video Creator\` (workspace & queue DB)
- The folder where you install the app (e.g. `C:\Program Files\AI Video Creator\` or `%LOCALAPPDATA%\Programs\AI Video Creator\`)

Open **Windows Security → Virus & threat protection → Manage settings → Exclusions → Add or remove exclusions** and add both folders.

---

## 2. Option B — Install from a built `.exe`

Use this if someone (you, on another machine) ran `npm run dist:win` and produced an installer in `dist/`.

1. Copy `AI Video Creator-<version>-x64.exe` from `dist/` to the Windows PC.
2. Double-click it.
3. **SmartScreen warning**: Windows may say *"Windows protected your PC"* because the build is unsigned. Click **More info → Run anyway**.
4. Pick an install location (default: `%LOCALAPPDATA%\Programs\AI Video Creator\`) → **Install**.
5. Launch it from the Start menu.

Skip to **section 4 — first-run setup**.

---

## 3. Option C — Build from source manually

Use this for development, or if you don't yet have a built installer.

### 3.1 Clone the repo

Open **PowerShell** in a folder where you want the source (e.g. `C:\dev`):

```powershell
cd C:\dev
git clone https://github.com/KavinduGM/heygen_video_tool.git
cd heygen_video_tool
```

### 3.2 Install dependencies

```powershell
npm install
```

The project has **no native modules** — no Visual Studio, no Python, no node-gyp needed. `npm install` only downloads JS packages and the pre-built `ffmpeg.exe` / `ffprobe.exe` binaries. If the install fails it's almost always a network timeout — re-run it.

### 3.3 Run in dev mode

```powershell
npm run dev
```

The app window opens with live reload. Source changes in `src/renderer` reload instantly; changes in `src/main` or `src/preload` restart the Electron main process. Skip to **section 4**.

### 3.4 (Optional) Build a Windows installer

When dev works and you want a packaged installer:

```powershell
npm run dist:win
```

The output appears in `dist/`:

- `AI Video Creator-0.1.0-x64.exe` — NSIS installer to give to other Windows users.
- `win-unpacked/` — the unpacked app directory; you can run `AI Video Creator.exe` directly from here.

Move the installer wherever you like. To install on this same machine, run it; SmartScreen will warn about an unsigned exe — *More info → Run anyway*.

---

## 4. First-run setup (both options)

Launch the app. You'll see a sidebar with **Queue / New job / Voice profiles / Settings**.

### 4.1 Settings

1. Click **Settings**.
2. **Claude (Anthropic)**:
   - Paste your **Anthropic API key** (starts with `sk-ant-…`). Get one at <https://console.anthropic.com/>.
   - Leave **Model** as `claude-opus-4-7` unless you have a reason to change.
3. **Voice / TTS server**:
   - **Base URL**: where your voice-clone server is reachable. Locally, that's `http://localhost:8000`. If you exposed it through a Cloudflare Tunnel, use the `https://…trycloudflare.com` URL.
   - **API key**: your `vct_…` key from the voice-clone server UI (Section 6 of the web UI).
   - Click **Test connection**. You want the green *"TTS server is healthy."* banner. If you see a 503, the model is still loading — wait 30–60 s and try again.
4. **Output and tools**:
   - **Default output folder**: e.g. `C:\Users\<you>\Desktop\Videos`. Each script can override this with its own `output_folder` value.
   - **Hyperframes command**: leave as `npx hyperframes`. If you get `'npx' is not recognized` errors later, replace with the full path, e.g. `C:\Program Files\nodejs\npx.cmd hyperframes`.
5. Click **Save settings**.

### 4.2 Voice profiles

1. Click **Voice profiles → New profile**.
2. Fill in:
   - **Display name**: e.g. `Narrator A`. This is what your scripts will reference under `voice_profile`.
   - **Description**: anything memorable.
   - **voice_id**: the 12-character hex ID from your voice server (`GET /api/voices` or copy from its UI).
   - **Speed**: default `1.0` (0.5–2.0 allowed).
   - **Format**: `mp3` is fine; `wav` if you prefer lossless intermediates.
3. **Create**. Add as many as you need.

### 4.3 Queue your first video

1. Click **New job → Load template** to drop the example script into the editor.
2. Edit:
   - `video_name` — your filename.
   - `ratio` — `16:9` for YouTube, `9:16` for TikTok/Reels, `1:1` for square, etc.
   - `output_folder` — e.g. `C:\Users\<you>\Desktop\Videos`.
   - `voice_profile` — match a profile's display name exactly.
   - Replace each scene's `explainer` and `voiceover`.
3. Click **Queue this script**.
4. The app jumps to **Queue**. The job moves *queued → running* and the progress bar advances per scene.
5. When status reads **completed**, click **Show file** to open the output folder in File Explorer.

### 4.4 Queueing many videos at once

In **New job**, click **Pick file(s) and queue**, select multiple `.yml` files (Ctrl-click or Shift-click), and they all enter the queue in the selection order. The worker runs them one at a time — close the app any time, pending jobs resume when you reopen.

---

## 5. Where things live on Windows

| Item | Path |
|---|---|
| App binary (Option A) | `%LOCALAPPDATA%\Programs\AI Video Creator\AI Video Creator.exe` |
| Settings + voice profiles | `%APPDATA%\AI Video Creator\ai-video-creator.json` |
| Job queue database | `%APPDATA%\AI Video Creator\queue.json` |
| Per-job intermediate files (HTML, audio, scene MP4s) | `%APPDATA%\AI Video Creator\workspace\<job-id>\` |
| Final MP4 output | whatever `output_folder` you set in the script |
| Source clone (Option B) | wherever you ran `git clone`, e.g. `C:\dev\heygen_video_tool\` |

`%APPDATA%` expands to `C:\Users\<you>\AppData\Roaming`. Paste that path into File Explorer to inspect logs or clear the workspace.

---

## 6. Updating

### Option A (installer)
Run the new installer over the old one. Settings, voice profiles, and queue history are preserved (they live in `%APPDATA%`, separate from the install).

### Option B (source)
```powershell
cd C:\dev\heygen_video_tool
git pull
npm install
npm run dev          # or  npm run dist:win
```

---

## 7. Troubleshooting

**"`'npx' is not recognized as an internal or external command`"**
Node isn't on PATH. Reopen PowerShell after installing Node, or set **Hyperframes command** in Settings to a full path like `C:\Program Files\nodejs\npx.cmd hyperframes`.

**"`hyperframes exited 127`" or the render hangs**
Run `npx hyperframes --help` in PowerShell from the same user account. If it fails, redo `npx skills add heygen-com/hyperframes`. If it works on the command line but not from the app, the app likely launched before Node was on PATH — restart the app (or reboot).

**"Claude did not return a complete HTML document"**
Opus sometimes wraps the HTML in commentary. Retry the job from the Queue (the **Retry** button on a failed row). If a specific scene keeps failing, simplify its `explainer`.

**TTS test returns `503`**
The voice server is still loading its XTTS model. Wait 30–60 s and click *Test connection* again.

**Job stuck on "Scene N: rendering with Hyperframes"**
Open **Details** on the job — the live `hyperframes:` log lines tell you exactly what the renderer is doing. Long renders (30+ s of high-resolution video) can take several minutes on a CPU-only PC. A discrete GPU helps a lot for the headless-Chromium pass.

**`npm install` keeps failing with `ETIMEDOUT` / `ECONNRESET`**
Network is flaky. `setup.bat` retries 3× with a long timeout already; if it still fails, disable VPN/proxy, try a different network, or run `npm install` manually in PowerShell — it picks up where it left off.

**Antivirus blocks `ffmpeg.exe` or the bundled Chromium**
Add the install folder to your antivirus exclusion list (see section 1.4). Some corporate AVs quarantine unsigned binaries silently — check the quarantine log.

**"Permission denied" writing to `C:\Program Files\...`**
Choose a different `output_folder` — anywhere under `C:\Users\<you>\` always works. The Program Files tree is read-only without admin rights.

---

## 8. Uninstall

**Option A**: *Settings → Apps → Installed apps → AI Video Creator → Uninstall*. To also wipe queue history and saved keys, delete `%APPDATA%\AI Video Creator\`.

**Option B**: delete the source folder. Wipe `%APPDATA%\AI Video Creator\` the same way to remove app data.
