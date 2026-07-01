# AI Video Creator

A cross-platform desktop tool (Windows-first, macOS too) that turns a structured YAML script into a finished MP4 by stringing together three engines:

1. **Your TTS API** synthesizes each scene's voiceover and the resulting audio drives every scene's duration.
2. **Claude Opus 4.7** turns each scene's `explainer` into a complete self-contained `index.html` motion-graphics composition matched to that duration.
3. **HeyGen Hyperframes** renders the HTML to MP4. The bundled **ffmpeg** muxes audio in and concatenates scenes with the transitions you chose.

A persistent SQLite queue means you can drop in a stack of scripts, let it grind through them one at a time, and even close the app — pending jobs resume next launch.

---

## Install

> **Windows users — fastest path**: clone the repo, then double-click `setup.bat` once and `start.bat` to run the app. Full guide at [`docs/WINDOWS_DEPLOY.md`](docs/WINDOWS_DEPLOY.md). The summary below is the macOS / general path.

You need **Node.js 20+** on the machine that runs the app (for `npx hyperframes`). On Windows install from <https://nodejs.org/>; on macOS use Homebrew or the installer.

```bash
# from the project root
npm install

# install the Hyperframes skill once (creates the global hyperframes CLI)
npx skills add heygen-com/hyperframes
```

The project has **no native modules** — no C++ compiler, no Visual Studio, no Python toolchain needed. Just Node.

Then either:

```bash
npm run dev            # live-reload dev mode
```

or build a packaged installer:

```bash
npm run dist:win       # Windows installer (.exe) in /dist
npm run dist:mac       # macOS .dmg in /dist
```

ffmpeg is bundled via `ffmpeg-static` and unpacked from the app archive automatically — you do not need to install it system-wide.

---

## First-run setup

1. Open the app → **Settings**.
2. Paste your **Anthropic API key** (used to call Opus 4.7 for HTML generation).
3. Enter your **TTS server** base URL and API key (the `vct_…` key from your voice-clone server).
4. Click **Test connection** — you should see a green "TTS server is healthy" banner.
5. Pick a **default output folder** (this is just a default; each script can override).
6. Go to **Voice profiles** → **New profile**. Give it a friendly name (e.g. `Narrator A`), the `voice_id` from your TTS server, and a default speed/format. Scripts refer to voices by this display name.

---

## The script format

The full template lives at [`templates/script.template.yml`](templates/script.template.yml) and is also viewable in the **New job** tab. The shape:

```yaml
video_name: "novapad-launch"
ratio: "16:9"                   # 16:9 | 9:16 | 1:1 | 4:5 | 21:9
output_folder: "C:/Users/me/Desktop/Videos"
voice_profile: "Narrator A"     # matches a saved profile
voice_speed: 1.0                # optional, 0.5–2.0

style:                          # optional, applied to all scenes
  description: "Modern, dark, bold typography"
  colors: ["#0F172A", "#38BDF8"]
  fonts: ["Inter"]

scenes:
  - explainer: |
      What the visuals should look like and feel like.
    voiceover: "The exact line the TTS should speak."
    transition_out:
      type: fade                # none | fade | dissolve | slide_(left|right|up|down) | wipe_(left|right|up|down)
      duration: 0.5
  - explainer: |
      Next scene…
    voiceover: "…"
    transition_out:
      type: none
      duration: 0
```

Validation is strict. Unknown top-level keys, unknown transitions, or out-of-range numbers are rejected before the job is even queued.

`description`, `colors`, and `fonts` can be written either at the top level or nested under `style:`. `colors` and `fonts` accept a YAML list (`- "#F5C842"`) **or** a plain string (`"warm yellow, sky blue, coral"`). `description` is free-form prose.

### 9:16 safe zones (stop edge-cropping)

For **9:16** videos the tool enforces a fixed layout grid on the 1080 × 1920 canvas so text and shapes never get cropped at the edges. There is a strict no-go margin around the frame and a usable **safe area** split into named bands and columns:

```
STRICT MARGINS (nothing is placed here):
  left 60px · right 60px · top 160px · bottom 240px
  (bottom is largest — that's where TikTok / Reels / Shorts put captions & buttons)

SAFE AREA: x[60 → 1020]  y[160 → 1680]   (960 wide × 1520 tall)

HORIZONTAL BANDS (top → bottom):        COLUMNS (left → right):
  TOP     y 160  → 464                    LEFT · CENTER · RIGHT
  UPPER   y 464  → 768                     (default alignment: CENTER)
  MIDDLE  y 768  → 1072
  LOWER   y 1072 → 1376
  BOTTOM  y 1376 → 1680
```

See [`templates/zone-map-9x16.svg`](templates/zone-map-9x16.svg) for a visual.

**How to use it in a script** — name a band (and optionally a column) in the step text:

```yaml
Step 1 (TOP band): heading writes in ...
Step 3 (MIDDLE band): white line writes in ...
Step 4 (BOTTOM band, CENTER): yellow line writes in ...
```

If you don't name bands, the lines are simply stacked and centered inside the safe area — still never cropped. The generator emits a required `#stage > .safe` scaffold pinned to those margins, and the visual reviewer **fails** any frame where text touches or crosses a strict margin. The grid is tuned specifically for 9:16; other ratios fall back to the generic layout rules.

### Scene length matters

Aim for **10–20 seconds of voiceover per scene**. Longer single scenes work but Claude struggles to fill 60+ seconds of unique animation, and the result can feel padded or repetitive. If your explainer has clearly distinct beats (an opening, a comparison section, a closing CTA, …), split each into its own scene with its own voiceover and a `transition_out` between them. You'll get tighter, more coherent motion, and the per-scene transitions make the cuts feel intentional.

### Single-scene scripts

If you only have one scene, just provide one entry in `scenes:`. The `transition_out` is ignored because there's nothing to transition into. The voiceover drives the scene length, and the final MP4 is that one scene re-encoded to your chosen aspect ratio.

### Multi-scene scripts

For multiple scenes the tool renders each scene independently, then concatenates them with the `transition_out` you set on every scene *except the last*. Transitions overlap the adjacent scenes — a 0.5 s fade between two 5 s scenes produces a 9.5 s final video, not 10 s.

---

## Adding jobs to the queue

Two ways from the **New job** tab:

- Paste YAML and hit **Queue this script**.
- **Pick file(s) and queue** — select one or many `.yml` / `.yaml` files; they are queued in selection order.

The worker picks up the next queued job immediately, processes it end-to-end, then moves to the next. Status, current step, progress bar, and full logs are visible per job under **Queue → Details**. Jobs survive app restart; running jobs that were interrupted by a crash are re-queued automatically on next boot.

---

## How a job is processed

For every scene the pipeline:

1. `POST /api/generate` to your TTS server → writes `audio.mp3` (or `.wav`).
2. `ffprobe` measures the audio's exact duration `D`.
3. Calls Claude Opus 4.7 with the scene's `explainer`, the `style`, the ratio, and `D`. Claude returns one complete HTML document with a `#stage` element sized to the ratio and total duration set to `D`.
4. Writes the HTML into a freshly-scaffolded Hyperframes project folder.
5. Runs `npx hyperframes render --output scene.mp4`.
6. ffmpeg muxes the audio with the rendered video, forced to length `D`.

When all scenes are rendered, ffmpeg's `xfade` and `acrossfade` filters glue them together using your transition choices, padding/letterboxing each scene to the exact ratio dimensions so output is uniform. The final MP4 is written as `<video_name>.mp4` in `output_folder`. If a file with that name already exists it's saved as `name (2).mp4`, `name (3).mp4`, etc — never overwritten.

---

## Storage locations

| Item | Location |
|---|---|
| Settings + voice profiles | `<userData>/ai-video-creator.json` |
| Queue database | `<userData>/queue.json` |
| Per-job working files (scene HTML, audio, intermediate MP4s) | `<userData>/workspace/<job-id>/` |

`<userData>` on Windows is `%APPDATA%/AI Video Creator/`, on macOS `~/Library/Application Support/AI Video Creator/`.

Workspace folders are kept after a job finishes — handy for debugging, deletable any time.

---

## Troubleshooting

- **"hyperframes exited 127" / "command not found"** — Node/npx isn't in PATH. Either install Node, or in Settings set **Hyperframes command** to an absolute path like `C:\Program Files\nodejs\npx.cmd hyperframes`.
- **"Claude did not return a complete HTML document"** — usually Claude wrapped the output in commentary. Retry from the queue. If it persists, simplify the explainer.
- **TTS test says 503** — the voice server is still loading its model. Retry after 30–60 seconds.
- **Scenes look squished / letterboxed** — the chosen `ratio` doesn't match what Claude generated. The concat step always pads to the canonical resolution for the ratio, so the final output is correct but a poorly-sized HTML will show black bars. Add a stronger style hint or re-queue.

---

## Project layout

```
src/
  main/              Electron main process
    pipeline/        parser.ts, tts.ts, claude.ts, hyperframes.ts, ffmpeg.ts, runner.ts
    db.ts            JSON-file persistent queue (no native deps)
    settings.ts      electron-store wrapper
    worker.ts        single-flight job dispatcher
    ipc.ts           IPC channel handlers
    index.ts         app bootstrap
  preload/index.ts   contextBridge surface (window.api)
  renderer/          React UI
    src/pages/       QueuePage, NewJobPage, SettingsPage, VoiceProfilesPage
  shared/types.ts    types + IPC channel names shared across processes
templates/
  script.template.yml   the format the parser expects
```
