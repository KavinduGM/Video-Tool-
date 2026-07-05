import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { Transition, TransitionType } from '@shared/types'

// In a packaged Electron app, ffmpeg-static returns a path inside app.asar that
// must be unpacked. electron-builder asarUnpack handles that, but the path comes
// back with /app.asar/ still in it — we rewrite to /app.asar.unpacked/.
function resolveBinary(p: string): string {
  if (process.env.NODE_ENV !== 'production' && !p.includes('app.asar')) return p
  return p.replace(/[\\/]app\.asar[\\/]/, `${path.sep}app.asar.unpacked${path.sep}`)
}

const FFMPEG = resolveBinary(ffmpegPath as unknown as string)
const FFPROBE = resolveBinary((ffprobeStatic as any).path as string)

export function runFfmpeg(args: string[], onLog?: (line: string) => void, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true, cwd })
    let stderrTail = ''
    p.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderrTail = (stderrTail + text).slice(-4000)
      if (onLog) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) onLog(line)
      }
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderrTail}`))
    })
  })
}

export async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      FFPROBE,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => (out += c.toString()))
    p.stderr.on('data', (c) => (err += c.toString()))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err}`))
      const v = parseFloat(out.trim())
      if (!Number.isFinite(v)) return reject(new Error(`ffprobe returned non-numeric: ${out}`))
      resolve(v)
    })
  })
}

export interface MuxArgs {
  videoIn: string
  audioIn: string
  out: string
  durationSeconds: number
  /**
   * Optional. Additional time appended to the end of the muxed scene where
   * the LAST video frame is held still and the audio track is padded with
   * silence. Used to give each scene a clean breath before the next one
   * begins. 0 = no tail.
   */
  tailHoldSeconds?: number
}

export async function muxAudioWithVideo(args: MuxArgs, onLog?: (l: string) => void): Promise<void> {
  const tail = Math.max(0, args.tailHoldSeconds ?? 0)
  const totalDuration = args.durationSeconds + tail

  // Without a tail, keep the simple stream-mapping path (fast, well-tested).
  if (tail === 0) {
    await runFfmpeg(
      [
        '-y',
        '-i', args.videoIn,
        '-i', args.audioIn,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-t', totalDuration.toFixed(3),
        args.out
      ],
      onLog
    )
    return
  }

  // With a tail: use filter_complex to (a) clone-pad the video by `tail`
  // seconds at the end (freezing the last frame) and (b) silence-pad the
  // audio by the same amount.
  const t = tail.toFixed(3)
  const filterComplex =
    `[0:v]tpad=stop_mode=clone:stop_duration=${t}[v];` +
    `[1:a]apad=pad_dur=${t}[a]`

  await runFfmpeg(
    [
      '-y',
      '-i', args.videoIn,
      '-i', args.audioIn,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', totalDuration.toFixed(3),
      args.out
    ],
    onLog
  )
}

/**
 * Mix a voiceover with a background-music bed. The voice stays at full volume
 * (normalize=0 so amix does NOT attenuate it) and the music is dropped to
 * `musicVolume` (e.g. 0.05 = 5%). The music is looped to cover the voice and
 * the output is trimmed to the voice length. Used for intro/outro segments.
 */
export async function mixVoiceWithMusic(
  args: { voiceIn: string; musicIn: string; out: string; musicVolume: number; durationSeconds: number },
  onLog?: (l: string) => void
): Promise<void> {
  const vol = Math.max(0, Math.min(1, args.musicVolume))
  await runFfmpeg(
    [
      '-y',
      '-i', args.voiceIn,
      '-stream_loop', '-1', '-i', args.musicIn, // loop music to always cover the voice
      '-filter_complex',
      `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      '-map', '[a]',
      '-t', args.durationSeconds.toFixed(3),
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      args.out
    ],
    onLog
  )
}

export interface ConcatArgs {
  scenes: { videoPath: string; durationSeconds: number; transitionOut: Transition }[]
  out: string
  width: number
  height: number
  fps?: number
}

/**
 * Concatenate scene clips. Transitions are applied at each boundary using ffmpeg's xfade
 * filter for video and acrossfade for audio. The transition.duration overlaps the two
 * adjacent scenes, so the final video is shorter than the sum of scene durations by
 * the total transition time.
 */
export async function concatScenesWithTransitions(
  args: ConcatArgs,
  onLog?: (l: string) => void
): Promise<void> {
  const { scenes, out, width, height } = args
  const fps = args.fps ?? 30
  if (scenes.length === 0) throw new Error('concat: scenes is empty')
  if (scenes.length === 1) {
    // Just re-encode to the target dimensions to be safe.
    await runFfmpeg(
      [
        '-y',
        '-i', scenes[0].videoPath,
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        out
      ],
      onLog
    )
    return
  }

  // Build filter_complex chain.
  const inputs: string[] = []
  for (const s of scenes) {
    inputs.push('-i', s.videoPath)
  }

  // Pre-normalise every scene's video stream (size, fps, pix_fmt) and audio (sample rate).
  const filterParts: string[] = []
  const vLabels: string[] = []
  const aLabels: string[] = []
  for (let i = 0; i < scenes.length; i++) {
    const v = `v${i}`
    const a = `a${i}`
    // settb=AVTB pins every stream to one common timebase. Without it, a chain
    // that MIXES hard cuts (concat filter) and crossfades (xfade) fails with
    // "input link main timebase (1/1000000) does not match xfade timebase
    // (1/30)" — the concat step re-clocks its output and every later xfade
    // refuses to configure.
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[${v}]`
    )
    filterParts.push(`[${i}:a]aformat=channel_layouts=stereo:sample_rates=48000,asetpts=PTS-STARTPTS[${a}]`)
    vLabels.push(v)
    aLabels.push(a)
  }

  // Chain xfade / acrossfade across the scenes.
  let prevV = vLabels[0]
  let prevA = aLabels[0]
  let prevDur = scenes[0].durationSeconds

  for (let i = 1; i < scenes.length; i++) {
    const trans = scenes[i - 1].transitionOut
    const xfadeName = mapTransitionToXfade(trans.type)
    const dur = trans.type === 'none' || !xfadeName ? 0 : Math.min(trans.duration, scenes[i].durationSeconds, prevDur)

    const outV = `vx${i}`
    const outA = `ax${i}`

    if (dur > 0 && xfadeName) {
      const offset = prevDur - dur
      filterParts.push(
        `[${prevV}][${vLabels[i]}]xfade=transition=${xfadeName}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`
      )
      filterParts.push(
        `[${prevA}][${aLabels[i]}]acrossfade=d=${dur.toFixed(3)}:c1=tri:c2=tri[${outA}]`
      )
      prevDur = prevDur + scenes[i].durationSeconds - dur
    } else {
      filterParts.push(`[${prevV}][${vLabels[i]}]concat=n=2:v=1:a=0[${outV}]`)
      filterParts.push(`[${prevA}][${aLabels[i]}]concat=n=2:v=0:a=1[${outA}]`)
      prevDur = prevDur + scenes[i].durationSeconds
    }
    prevV = outV
    prevA = outA
  }

  const filter = filterParts.join(';')
  await runFfmpeg(
    [
      '-y',
      ...inputs,
      '-filter_complex', filter,
      '-map', `[${prevV}]`,
      '-map', `[${prevA}]`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      out
    ],
    onLog
  )
}

export function mapTransitionToXfade(t: TransitionType): string | null {
  switch (t) {
    case 'fade':
      return 'fade'
    case 'dissolve':
      return 'dissolve'
    case 'slide_left':
      return 'slideleft'
    case 'slide_right':
      return 'slideright'
    case 'slide_up':
      return 'slideup'
    case 'slide_down':
      return 'slidedown'
    case 'wipe_left':
      return 'wipeleft'
    case 'wipe_right':
      return 'wiperight'
    case 'wipe_up':
      return 'wipeup'
    case 'wipe_down':
      return 'wipedown'
    case 'diag_wipe':
      // Diagonal wipe from the bottom-left corner toward the top-right —
      // used internally for the intro/outro layered wipe transition.
      return 'diagbl'
    case 'circle_open':
      // Circle expanding from the center — used internally for the
      // intro/outro circle-pop transition.
      return 'circleopen'
    case 'none':
    default:
      return null
  }
}

// ====================================================================
// TRANSITION CLIPS (intro ↔ scenes ↔ outro)
// ====================================================================
// A short clip of solid color layers sweeping across the frame — either
// diagonal bands (bottom-left → top-right) or circles expanding from the
// center. The runner inserts it between segments:
//   outgoing video → first layer sweeps in OVER it (xfade join, riding
//   the outgoing segment's held-frame tail) → layer-on-layer sweeps →
//   the LAST color fully fills the screen and HOLDS a short beat → HARD
//   CUT into the incoming segment. The incoming video therefore starts
//   only AFTER the transition has completely ended (its own content then
//   animates in ~0.35s later — the "little gap").
// The whoosh sound (if configured) is baked in as the clip's audio
// track. Entirely deterministic ffmpeg — identical output every time —
// and verified after building (duration probe + frame sampling).

export const WIPE_TRANSITION_SECONDS = 0.85
/** the last color holds the full frame this long before the hard cut */
const WIPE_HOLD_SECONDS = 0.12

export interface TransitionStyle {
  name: string
  /** internal TransitionType used for the outgoing-side xfade join */
  join: TransitionType
  /** ffmpeg xfade transition name used inside the clip */
  xfade: string
  /** layer colors, first to last (last one fills and holds) */
  colors: string[]
}

// Brand palette rule: each transition uses ONE color family only — blue
// styles use blue grades (sky/royal/navy), yellow styles use yellow grades
// (pale/golden/deep gold). NEVER mixed within a transition. Video is
// encoded limited-range (luma gaps shrink ×0.86), so at least one layer
// pair per style keeps a FULL-RANGE luma gap >65 — proven to register in
// the deterministic clip review on real renders.
export const TRANSITION_STYLES: TransitionStyle[] = [
  { name: 'diag-blue', join: 'diag_wipe', xfade: 'diagbl', colors: ['0x6BB6FF', '0x2653F1', '0x0F1D5C'] },
  { name: 'diag-gold', join: 'diag_wipe', xfade: 'diagbl', colors: ['0xFFF7C2', '0xE8A800', '0x705200'] },
  { name: 'circle-sun', join: 'circle_open', xfade: 'circleopen', colors: ['0xFFE9A0', '0xD69E00'] },
  { name: 'circle-sky', join: 'circle_open', xfade: 'circleopen', colors: ['0x8FC7FF', '0x14275E'] }
]

/**
 * Pick the transition style for a video. Hash-seeded by the video name, so
 * styles vary "randomly" across videos but one video ALWAYS uses the same
 * style at both joins (and re-runs are reproducible).
 */
export function pickTransitionStyle(seed: string): TransitionStyle {
  let h = 2166136261
  const s = `wipe:${seed}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return TRANSITION_STYLES[(h >>> 0) % TRANSITION_STYLES.length]
}

/**
 * Pure: the video filter graph chaining the style's colors with staggered
 * xfades, leaving the final color to hold the frame for WIPE_HOLD_SECONDS
 * before the clip ends. Exported for tests.
 */
export function buildWipeFilterGraph(durationSeconds: number, xfadeName: string, colorCount: number): string {
  const usable = Math.max(0.4, durationSeconds - WIPE_HOLD_SECONDS)
  const xdur = Math.min(0.3, usable * 0.4)
  const sweeps = Math.max(1, colorCount - 1)
  let prev = '0:v'
  let graph = ''
  let lastOffset = 0
  for (let i = 0; i < sweeps; i++) {
    let off = Math.max(0.05, (usable * (i + 1)) / colorCount - xdur / 2)
    off = Math.min(off, usable - xdur)
    off = Math.max(off, lastOffset + 0.05)
    lastOffset = off
    const label = i === sweeps - 1 ? 'vw' : `vw${i + 1}`
    graph += `${i ? ';' : ''}[${prev}][${i + 1}:v]xfade=transition=${xfadeName}:duration=${xdur.toFixed(3)}:offset=${off.toFixed(3)}[${label}]`
    prev = label
  }
  return graph
}

export async function buildWipeTransitionClip(
  args: {
    out: string
    width: number
    height: number
    style: TransitionStyle
    fps?: number
    durationSeconds?: number
    /** optional whoosh SFX; silent when absent */
    whooshPath?: string
  },
  onLog?: (l: string) => void
): Promise<void> {
  const d = args.durationSeconds ?? WIPE_TRANSITION_SECONDS
  const fps = args.fps ?? 30
  const size = `${args.width}x${args.height}`
  const colors = args.style.colors
  const inputs: string[] = []
  for (const c of colors) {
    inputs.push('-f', 'lavfi', '-i', `color=c=${c}:s=${size}:r=${fps}:d=${d.toFixed(3)}`)
  }
  const audioIdx = colors.length
  let audioMap: string
  let filter = buildWipeFilterGraph(d, args.style.xfade, colors.length)
  if (args.whooshPath) {
    inputs.push('-i', args.whooshPath)
    // Lock the whoosh EXACTLY to the transition window: strip any leading
    // silence baked into the sample (so the sound starts the instant the
    // transition starts), trim to the clip length, and end with a short
    // fade-out that finishes precisely at the clip end — no spill, no click.
    filter +=
      `;[${audioIdx}:a]silenceremove=start_periods=1:start_threshold=-40dB,` +
      `atrim=0:${d.toFixed(3)},aformat=channel_layouts=stereo:sample_rates=48000,` +
      `afade=t=out:st=${Math.max(0, d - 0.15).toFixed(3)}:d=0.15,apad=whole_dur=${d.toFixed(3)}[aw]`
    audioMap = '[aw]'
  } else {
    inputs.push('-f', 'lavfi', '-t', d.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
    audioMap = `${audioIdx}:a`
  }
  await runFfmpeg(
    [
      '-y',
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vw]',
      '-map', audioMap,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', d.toFixed(3),
      args.out
    ],
    onLog
  )
}

/** Pure verdict on a transition clip's sampled ink signal. Exported for tests. */
export function evaluateTransitionSample(global: number[]): { ok: boolean; detail: string } {
  if (global.length < 4) return { ok: false, detail: `only ${global.length} frames sampled` }
  const finalInk = global[global.length - 1]
  const midMax = Math.max(...global.slice(1, -1))
  const ok = finalInk <= 0.02 && midMax >= 0.04
  return {
    ok,
    detail: `final frame ink ${finalInk.toFixed(3)} (solid requires ≤0.02), sweep visibility ${midMax.toFixed(3)} (requires ≥0.04)`
  }
}

/**
 * Deterministic REVIEW of the built transition clip: the duration must match,
 * the sweeps must actually be visible mid-clip, and the final frame must be a
 * SOLID fill (so the hard cut into the next segment happens only after the
 * transition has fully completed). No AI involved.
 */
export async function verifyTransitionClip(
  args: { clipPath: string; durationSeconds: number; workDir: string },
  onLog?: (l: string) => void
): Promise<{ ok: boolean; detail: string }> {
  try {
    const dur = await probeDurationSeconds(args.clipPath)
    if (Math.abs(dur - args.durationSeconds) > 0.2) {
      return { ok: false, detail: `clip duration ${dur.toFixed(2)}s differs from expected ${args.durationSeconds.toFixed(2)}s` }
    }
    const sample = await sampleInkFractions(
      { videoIn: args.clipPath, count: 8, durationSeconds: args.durationSeconds, workDir: args.workDir },
      onLog
    )
    return evaluateTransitionSample(sample.global)
  } catch (err: any) {
    return { ok: false, detail: `verification failed to run: ${err?.message ?? err}` }
  }
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Burn an ASS subtitle file into a video. The ass filter's filename argument
 * chokes on Windows drive-letter colons, so we run ffmpeg with cwd set to the
 * subtitle's directory and pass just the bare filename — no escaping needed.
 * Audio is copied untouched.
 */
export async function burnSubtitles(
  args: { videoIn: string; assDir: string; assFile: string; out: string },
  onLog?: (l: string) => void
): Promise<void> {
  await runFfmpeg(
    [
      '-y',
      '-i', args.videoIn,
      '-vf', `ass=${args.assFile}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'copy',
      args.out
    ],
    onLog,
    args.assDir
  )
}

/** Grid used for the per-region motion signal (row-major cells). */
export const INK_GRID = { cols: 4, rows: 6 } as const

export interface InkSample {
  /** per-frame fraction of pixels that differ from the background */
  global: number[]
  /** per-frame, per-cell ink fractions (INK_GRID.cols × INK_GRID.rows, row-major) */
  cells: number[][]
  /**
   * FINAL-frame ink fraction inside each outer margin strip (with a small
   * buffer past the safe boundary, so content legally AT the safe edge never
   * trips it). Ink here = content cropped at the frame edge or invading the
   * reserved margins — measured on real output pixels, immune to the
   * DOM-measurement/font mismatches that can let crops slip past pre-render
   * fitting.
   */
  edges: { left: number; right: number; top: number; bottom: number }
}

/**
 * Sample the rendered video at `count` evenly-spaced times and return, for each
 * sampled frame, the fraction of pixels that are "ink" — pixels that DIFFER from
 * the frame's dominant luma. The dominant luma is the background, whatever its
 * color: on a black scene ink = bright pixels, on a light intro/outro card ink =
 * dark text. (A fixed brightness threshold made every pixel of a light card
 * count as content, which false-flagged intros/outros as "all at once".)
 *
 * Also returns the same signal per GRID CELL, so the motion audit can catch a
 * single element flickering in one region even when the global ink barely moves.
 * Frames are downscaled to a tiny grayscale buffer so the whole thing is a
 * single fast ffmpeg pass with no image-decoder dependency.
 */
export async function sampleInkFractions(
  args: { videoIn: string; count: number; durationSeconds: number; workDir: string },
  onLog?: (l: string) => void
): Promise<InkSample> {
  const W = 64
  const H = 114 // ~9:16
  const frameSize = W * H
  const rawPath = path.join(args.workDir, `motion-${randomUUID()}.raw`)
  const fps = `${args.count}/${args.durationSeconds.toFixed(3)}`
  try {
    await runFfmpeg(
      [
        '-y',
        '-i', args.videoIn,
        '-vf', `fps=${fps},scale=${W}:${H},format=gray`,
        '-frames:v', String(args.count),
        '-f', 'rawvideo',
        '-pix_fmt', 'gray',
        rawPath
      ],
      onLog
    )
    const buf = await fs.promises.readFile(rawPath)
    const frames = Math.floor(buf.length / frameSize)
    const DIFF = 48 // |pixel − background| above this counts as content
    const { cols, rows } = INK_GRID
    const cellW = W / cols // 16
    const cellH = H / rows // 19
    const cellArea = cellW * cellH
    const global: number[] = []
    const cells: number[][] = []
    for (let f = 0; f < frames; f++) {
      const base = f * frameSize
      // Dominant luma bin = the background (works for dark AND light cards).
      const hist = new Uint32Array(32)
      for (let p = 0; p < frameSize; p++) hist[buf[base + p] >> 3]++
      let bgBin = 0
      for (let b = 1; b < 32; b++) if (hist[b] > hist[bgBin]) bgBin = b
      const bg = bgBin * 8 + 4
      let ink = 0
      const cellInk = new Float64Array(cols * rows)
      for (let y = 0; y < H; y++) {
        const rowBase = base + y * W
        const cy = Math.min(rows - 1, Math.floor(y / cellH))
        for (let x = 0; x < W; x++) {
          if (Math.abs(buf[rowBase + x] - bg) > DIFF) {
            ink++
            cellInk[cy * cols + Math.min(cols - 1, Math.floor(x / cellW))]++
          }
        }
      }
      global.push(ink / frameSize)
      cells.push(Array.from(cellInk, (n) => n / cellArea))
    }

    // Ground-truth margin check on the FINAL frame. Strip bounds sit a small
    // buffer OUTSIDE the safe area (safe x∈[60,1020] y∈[160,1540] at
    // 1080×1920), so legal content touching the safe edge never registers:
    //   left  < 50px   right > 1030px   top < 150px   bottom > 1550px
    const edges = { left: 0, right: 0, top: 0, bottom: 0 }
    if (frames > 0) {
      const base = (frames - 1) * frameSize
      const hist = new Uint32Array(32)
      for (let p = 0; p < frameSize; p++) hist[buf[base + p] >> 3]++
      let bgBin = 0
      for (let b = 1; b < 32; b++) if (hist[b] > hist[bgBin]) bgBin = b
      const bg = bgBin * 8 + 4
      const leftMax = Math.floor((W * 50) / 1080) // x ≤ 2
      const rightMin = Math.ceil((W * 1030) / 1080) // x ≥ 62
      const topMax = Math.floor((H * 150) / 1920) // y ≤ 8
      const bottomMin = Math.ceil((H * 1550) / 1920) // y ≥ 93
      let l = 0, r = 0, t = 0, bo = 0
      for (let y = 0; y < H; y++) {
        const rowBase = base + y * W
        for (let x = 0; x < W; x++) {
          if (Math.abs(buf[rowBase + x] - bg) <= DIFF) continue
          if (x <= leftMax) l++
          if (x >= rightMin) r++
          if (y <= topMax) t++
          if (y >= bottomMin) bo++
        }
      }
      edges.left = l / ((leftMax + 1) * H)
      edges.right = r / ((W - rightMin) * H)
      edges.top = t / ((topMax + 1) * W)
      edges.bottom = bo / ((H - bottomMin) * W)
    }
    return { global, cells, edges }
  } finally {
    fs.promises.rm(rawPath, { force: true }).catch(() => {})
  }
}

/**
 * Extract a single still frame from a rendered MP4 at the given timestamp,
 * encoded as a JPEG for passing to Claude's vision API. Captures near the end
 * by default so the composition is in its final, settled state.
 */
/**
 * Auto-trim a PNG's transparent border. Template PNGs exported from design
 * tools (Canva etc.) carry large transparent margins around the subject —
 * those empty pixels count as image, shrinking the subject inside its slot
 * box. This detects the alpha bounding box (alphaextract + cropdetect) and
 * crops to it, so every hero PNG behaves like a tight "sticker" regardless
 * of how it was exported. Falls back to a plain copy when detection fails
 * or there is nothing to trim.
 */
export async function trimPngAlpha(
  args: { src: string; dest: string },
  onLog?: (l: string) => void
): Promise<{ trimmed: boolean; crop?: string }> {
  let lastCrop: string | null = null
  try {
    await runFfmpeg(
      [
        '-y',
        // -loop with skip=0: cropdetect skips its first 2 frames by default,
        // and a PNG has only one — loop the still and disable the skip.
        '-loop', '1',
        '-i', args.src,
        '-vf', 'format=rgba,alphaextract,cropdetect=limit=8:round=2:reset=0:skip=0',
        '-frames:v', '2',
        '-f', 'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null'
      ],
      (line) => {
        const m = line.match(/crop=(\d+:\d+:\d+:\d+)/)
        if (m) lastCrop = m[1]
        onLog?.(line)
      }
    )
  } catch {
    lastCrop = null
  }
  if (lastCrop) {
    const [w, h] = (lastCrop as string).split(':').map((n) => parseInt(n, 10))
    if (w > 8 && h > 8) {
      try {
        await runFfmpeg(
          ['-y', '-i', args.src, '-vf', `format=rgba,crop=${lastCrop}`, '-frames:v', '1', args.dest],
          onLog
        )
        return { trimmed: true, crop: lastCrop }
      } catch {
        /* fall through to plain copy */
      }
    }
  }
  await fs.promises.copyFile(args.src, args.dest)
  return { trimmed: false }
}

export async function extractFrame(
  args: { videoIn: string; atSeconds: number; out: string; quality?: number },
  onLog?: (l: string) => void
): Promise<void> {
  const q = args.quality ?? 3 // 2 = best, 31 = worst; 3 is high quality, small file
  await runFfmpeg(
    [
      '-y',
      '-ss', args.atSeconds.toFixed(3),
      '-i', args.videoIn,
      '-vframes', '1',
      '-q:v', String(q),
      args.out
    ],
    onLog
  )
}
