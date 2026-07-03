// =====================================================================
// MOTION AUDIT — deterministic, multi-frame review of the RENDERED video
// =====================================================================
// The vision reviewer only ever sees a single still frame, so it is blind
// to motion: a scene that flickers or loops has a fine-looking final frame
// and passes. This module analyzes the "ink over time" signal (fraction of
// content pixels per sampled frame, from ffmpeg.sampleInkFractions — which
// is background-relative, so it works on dark scenes AND light title cards)
// to catch the motion defects a single frame cannot:
//
//   - LOOP / FLICKER, global: the total ink rises, drops well below its
//     peak, and content is gone — the whole composition loops.
//   - LOOP / FLICKER, regional: ONE element (e.g. the title) disappears and
//     reappears while everything else stays. The global ink barely moves,
//     so this is detected PER GRID CELL: a cell whose content vanishes
//     TWICE OR MORE is flickering. (A single drop can be a legitimate
//     beat transition; repeated vanishing never is.)
//   - ALL-AT-ONCE: the whole composition is present from the first frame,
//     with no progressive reveal.
//
// When it finds a defect it returns a SYSTEM-AUTHORED guided fix (what to
// do, not just the symptom) that feeds straight into the repair prompt.
// =====================================================================

// Must match ffmpeg.ts INK_GRID.
const GRID_COLS = 4
const ROW_NAMES = ['top', 'upper', 'upper-middle', 'lower-middle', 'lower', 'bottom']
const COL_NAMES = ['left', 'center-left', 'center-right', 'right']

export interface MotionVerdict {
  loop: boolean
  allAtOnce: boolean
  blank: boolean
  inks: number[]
  loopRegions: string[]
  issues: string[]
}

const LOOP_GUIDE =
  'MOTION: one or more elements loop/flicker — they disappear and reappear during the scene ' +
  'instead of staying on screen. FIX: make EVERY animation play exactly ONCE and hold its final ' +
  'state. Use animation-iteration-count:1 and animation-fill-mode:both for CSS, repeat:0 and ' +
  'yoyo:false for GSAP, and remove any pulsing, blinking, glowing, breathing, or looping effect ' +
  '(including any "soft pop" written as a repeating pulse). Never use setInterval for visible ' +
  'motion. After each element reveals, it must remain fully visible and static until the scene ends.'

const STAGGER_GUIDE =
  'MOTION: all elements appear at once with no progressive reveal. FIX: stagger the reveals across ' +
  'the first ~70% of the scene. Give each text line and shape its own increasing start time — the ' +
  'heading first (~0.3s), then each following line about 0.6–1.0s after the previous one — each ' +
  'starting from opacity:0 and writing/fading in exactly once. Inside a box, reveal the box outline ' +
  'first, then its inner lines one after another (not all together).'

/** True when a review issue came from the loop/flicker detector. */
export function isLoopIssue(issue: string): boolean {
  return /^MOTION: .*loop\/flicker/.test(issue)
}

/**
 * Analyze the ink-over-time samples. Thresholds are deliberately conservative so
 * a normal write-on (ink climbs, then holds) passes, and only genuine looping or
 * instant-full compositions are flagged.
 */
export function analyzeMotion(sample: { global: number[]; cells?: number[][] }): MotionVerdict {
  const inks = sample.global
  const issues: string[] = []
  const max = inks.length ? Math.max(...inks) : 0

  // Near-empty render — let the vision reviewer handle "nothing rendered".
  if (max < 0.003) {
    return { loop: false, allAtOnce: false, blank: true, inks, loopRegions: [], issues }
  }

  // GLOBAL LOOP: after content reaches a peak, does the total ink drop well
  // below that peak (most content vanished)? A monotonic rise + hold never does.
  let peak = 0
  let globalLoop = false
  for (const v of inks) {
    peak = Math.max(peak, v)
    if (peak > 0.01 && v < peak * 0.6) globalLoop = true
  }

  // REGIONAL LOOP: per grid cell, count how many times the cell's content
  // vanishes (drops below 45% of its local peak) after having been visible.
  // One drop can be an intentional beat transition; TWO OR MORE drops in the
  // same region is flicker — content that keeps disappearing and reappearing.
  const loopRegions: string[] = []
  const cells = sample.cells
  if (cells && cells.length >= 4 && cells[0]) {
    const cellCount = cells[0].length
    const seen = new Set<string>()
    for (let c = 0; c < cellCount; c++) {
      let localPeak = 0
      let falls = 0
      for (const frame of cells) {
        const v = frame[c] ?? 0
        if (v > localPeak) {
          localPeak = v
        } else if (localPeak >= 0.05 && v < localPeak * 0.45) {
          falls++
          localPeak = v
        }
      }
      if (falls >= 2) {
        const row = Math.min(ROW_NAMES.length - 1, Math.floor(c / GRID_COLS))
        const col = c % GRID_COLS
        const name = `${ROW_NAMES[row]} ${COL_NAMES[col]}`
        if (!seen.has(name)) {
          seen.add(name)
          loopRegions.push(name)
        }
      }
    }
  }

  const loop = globalLoop || loopRegions.length > 0

  // ALL-AT-ONCE: the composition reaches ~85% of its final ink by the 2nd sample.
  let riseIndex = inks.findIndex((v) => v >= 0.85 * max)
  if (riseIndex < 0) riseIndex = inks.length - 1
  const allAtOnce = inks.length >= 4 && riseIndex <= 1

  if (loop) {
    const where =
      loopRegions.length > 0
        ? ` Deterministic frame analysis located the flicker in the ${loopRegions.slice(0, 4).join('; ')} region(s) of the frame — find the animated element(s) there and fix them specifically.`
        : ''
    issues.push(LOOP_GUIDE + where)
  }
  if (allAtOnce) issues.push(STAGGER_GUIDE)

  return { loop, allAtOnce, blank: false, inks, loopRegions, issues }
}
