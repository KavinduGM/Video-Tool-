// =====================================================================
// 9:16 SAFE-ZONE GRID
// =====================================================================
// A fixed layout contract for 1080x1920 vertical shorts. Its job is to
// stop text/shapes from being cropped at the frame edges and to give
// script writers a shared vocabulary for WHERE content should sit.
//
// The whole system is intentionally locked to 9:16 — the numbers below
// are hand-tuned for that one canvas and are NOT generalized to other
// ratios. Everything here is plain data + string builders so it can be
// imported from both the Electron main process and the renderer.
// =====================================================================

export const NINE_SIXTEEN = {
  width: 1080,
  height: 1920,

  // Strict margins (the "no-go" band around the edge). Nothing — no text,
  // no shape, no stroke — may enter these. The bottom margin is deliberately
  // the largest because TikTok / Reels / Shorts overlay captions, the
  // username, and the action buttons there.
  margin: {
    left: 60,
    right: 60,
    top: 160,
    bottom: 240
  }
} as const

// The usable rectangle, derived from the margins.
export const SAFE_AREA = {
  left: NINE_SIXTEEN.margin.left, // 60
  right: NINE_SIXTEEN.width - NINE_SIXTEEN.margin.right, // 1020
  top: NINE_SIXTEEN.margin.top, // 160
  bottom: NINE_SIXTEEN.height - NINE_SIXTEEN.margin.bottom, // 1680
  get width() {
    return this.right - this.left // 960
  },
  get height() {
    return this.bottom - this.top // 1520
  }
} as const

// Five horizontal bands, top → bottom, each an equal slice of the safe area.
export interface Band {
  name: string
  /** vertical pixel range within the full 1080x1920 canvas */
  top: number
  bottom: number
}

function computeBands(): Band[] {
  const names = ['TOP', 'UPPER', 'MIDDLE', 'LOWER', 'BOTTOM']
  const bandHeight = SAFE_AREA.height / names.length // 304
  return names.map((name, i) => ({
    name,
    top: Math.round(SAFE_AREA.top + i * bandHeight),
    bottom: Math.round(SAFE_AREA.top + (i + 1) * bandHeight)
  }))
}

export const BANDS: Band[] = computeBands()

// Three columns, left → right, each an equal slice of the safe-area width.
export interface Column {
  name: string
  left: number
  right: number
}

function computeColumns(): Column[] {
  const names = ['LEFT', 'CENTER', 'RIGHT']
  const colWidth = SAFE_AREA.width / names.length // 320
  return names.map((name, i) => ({
    name,
    left: Math.round(SAFE_AREA.left + i * colWidth),
    right: Math.round(SAFE_AREA.left + (i + 1) * colWidth)
  }))
}

export const COLUMNS: Column[] = computeColumns()

/**
 * The exact HTML/CSS scaffold Claude must emit for a 9:16 scene. Presented in
 * the prompt as a required pattern. `#stage` is the full canvas with
 * overflow:hidden (a hard clip guard); `.safe` is pinned to the margins so
 * every child is guaranteed to stay off the physical edges.
 */
export function safeScaffold(durationSeconds: number): string {
  const d = durationSeconds.toFixed(3)
  const m = NINE_SIXTEEN.margin
  return `<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${d}"
     style="position:relative; width:1080px; height:1920px; overflow:hidden; background:#000000;">
  <div class="safe"
       style="position:absolute; left:${m.left}px; right:${m.right}px; top:${m.top}px; bottom:${m.bottom}px;
              display:flex; flex-direction:column; align-items:center; justify-content:center;
              box-sizing:border-box; gap:32px;">
    <!-- EVERY visible element goes in here. Nothing may sit outside .safe. -->
  </div>
</div>`
}

/**
 * The full instruction block appended to the user prompt for 9:16 scenes.
 * Describes the margins, the band/column grid, the required scaffold, and how
 * to honor band references that appear in the explainer.
 */
export function zoneGuideForPrompt(durationSeconds: number): string {
  const m = NINE_SIXTEEN.margin
  const bandLines = BANDS.map(
    (b) => `      - ${b.name.padEnd(7)} y ${b.top} → ${b.bottom} px`
  ).join('\n')
  const colLines = COLUMNS.map(
    (c) => `      - ${c.name.padEnd(7)} x ${c.left} → ${c.right} px`
  ).join('\n')

  return `9:16 SAFE-ZONE CONTRACT (HARD REQUIREMENT — this is the #1 cause of rejected renders):

  Canvas is exactly 1080 x 1920. There is a STRICT no-go margin around every edge.
  NOTHING may enter it — no text, no shape, no stroke, no glow, not one pixel:
      - left   margin: ${m.left}px
      - right  margin: ${m.right}px
      - top    margin: ${m.top}px
      - bottom margin: ${m.bottom}px   (largest — platform captions & buttons live here)

  The usable SAFE AREA is therefore x[${SAFE_AREA.left}, ${SAFE_AREA.right}] by y[${SAFE_AREA.top}, ${SAFE_AREA.bottom}]
  (${SAFE_AREA.width} wide by ${SAFE_AREA.height} tall). ALL content lives inside this rectangle.

  REQUIRED SCAFFOLD — emit exactly this structure (fill in your content inside .safe):
${safeScaffold(durationSeconds)}
    - #stage is the full canvas with overflow:hidden as a hard clip guard.
    - .safe is pinned to the margins. Because every element is a descendant of
      .safe, nothing can reach the physical edges. Do NOT position anything
      relative to #stage directly, and do NOT use negative margins/offsets that
      would push a child back out past .safe.

  HORIZONTAL BANDS (top → bottom) — the placement vocabulary the script uses:
${bandLines}

  COLUMNS (left → right):
${colLines}

  HOW TO PLACE CONTENT:
    - If the explainer names a band for a line (e.g. "TOP band:", "(MIDDLE)",
      "in the LOWER third"), put that line in the matching band. Structure .safe
      as stacked band rows (each a flex row, vertically centered) and drop each
      line into its named band. Default column alignment is CENTER unless a
      column (LEFT/RIGHT) is named.
    - If the explainer does NOT name bands, simply stack the lines in .safe with
      even spacing (the flex column already centers them). You still must keep
      everything inside .safe.
    - Every text line still obeys the one-visual-line rule: white-space:nowrap,
      overflow-wrap:normal, word-break:keep-all, and a font-size small enough
      that the LONGEST line fits within the ${SAFE_AREA.width}px safe width. A line that
      would exceed ${SAFE_AREA.width}px MUST use a smaller font-size — never let it spill
      toward the edges.

  FINAL SELF-CHECK for the safe zone:
    - Is every element a descendant of .safe? (yes required)
    - At the final frame, does any text or shape touch or cross x<${SAFE_AREA.left},
      x>${SAFE_AREA.right}, y<${SAFE_AREA.top}, or y>${SAFE_AREA.bottom}? (must be NO)
    - Does the widest line fit within ${SAFE_AREA.width}px? (must be YES)`
}

/**
 * The safe-zone paragraph handed to the vision reviewer for 9:16 frames so it
 * actively rejects edge-cropping instead of only checking content/shape/overlap.
 */
export function zoneGuideForReviewer(): string {
  const m = NINE_SIXTEEN.margin
  return `SAFE-ZONE CHECK (this is a 9:16 / 1080x1920 vertical video):
  There is a strict no-go margin: ${m.left}px left, ${m.right}px right, ${m.top}px top, ${m.bottom}px bottom.
  All content must sit inside the safe area x[${SAFE_AREA.left}, ${SAFE_AREA.right}], y[${SAFE_AREA.top}, ${SAFE_AREA.bottom}].
  FAIL the scene if ANY text or shape:
    - is clipped / cut off at the left, right, top, or bottom edge of the frame, OR
    - sits so close to an edge that it visibly touches or enters the margin, OR
    - extends beyond the readable area on either side.
  When you flag this, name the edge and the exact text, e.g.
  "The line 'Universal means everyone' is cut off on the right edge — it runs past the safe area."`
}

/** The band names, for docs / template generation. */
export const BAND_NAMES = BANDS.map((b) => b.name)
