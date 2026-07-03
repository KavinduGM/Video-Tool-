// =====================================================================
// SYSTEM-PROVIDED SHAPE PRIMITIVES (9:16)
// =====================================================================
// Two recurring defects when Claude hand-draws boxes/circles with text:
//   1. Open sides — Claude uses an SVG stroke write-on (stroke-dashoffset)
//      and miscomputes the path length, so one edge never finishes drawing.
//   2. Text overlapping the outline — Claude absolutely-positions a fixed
//      box and separately positions text that doesn't fit inside it.
//
// Both are structural, so we fix them structurally instead of by advice:
//
//   - The border is drawn by a CSS border on a full-inset ::before pseudo-
//     element. A CSS border box CANNOT render with an open side — the
//     browser always closes all four edges (and border-radius:50% for a
//     circle). The hand-drawn wobble is a displacement filter applied ONLY
//     to that pseudo-element, so the border looks marker-drawn while the
//     text (a normal child, unfiltered) stays crisp.
//   - Text goes INSIDE the box as padded flex children. The box auto-sizes
//     around the text with a guaranteed padding gap, so text can never
//     touch or cross the outline.
//
// The system injects this stylesheet into every 9:16 scene, so the
// primitive is always present and always correct regardless of what Claude
// wrote. Claude just fills the box with text lines.
// =====================================================================

export const SHAPE_STYLE_ID = 'hf-shapes'

/**
 * The stylesheet + filter defs. Injected verbatim. The `::before` border is
 * the guaranteed-closed outline; `--hf-bw` is the stroke width and the box's
 * own `color` sets the outline color (so `color:#5BC8F5` gives a sky-blue box).
 */
function shapeCss(): string {
  return `<style id="${SHAPE_STYLE_ID}">
  /* -----------------------------------------------------------------
     GLOBAL LOOP KILL — this is a one-pass write-on video. Force EVERY
     CSS animation to run exactly once and hold its end state, so nothing
     can flicker/pulse/loop regardless of what the generator wrote.
     fill-mode:both keeps each element in its hidden 0% state before its
     delay (preserving the staggered reveal) and its final state after.
     ----------------------------------------------------------------- */
  *, *::before, *::after {
    animation-iteration-count: 1 !important;
    animation-fill-mode: both !important;
    animation-direction: normal !important;
  }

  .hf-box, .hf-circle {
    position: relative;
    box-sizing: border-box;
    display: flex;
    --hf-bw: 4px;
  }
  .hf-box {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding: 44px 52px;      /* guaranteed gap between text and the outline */
    max-width: 900px;        /* stay well within the 960px safe width */
  }
  .hf-circle {
    /* A DEFINITE, fixed diameter. Do NOT rely on aspect-ratio here: in a flex
       column without a definite width, aspect-ratio can resolve the height to
       zero, which collapses the round border to nothing (the "empty middle /
       circle missing" bug). An explicit width AND height can never collapse. */
    width: 360px;
    height: 360px;
    flex: 0 0 auto;          /* never let a flex parent shrink it away */
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 36px;
  }
  /* The outline: a clean CSS border on a full-inset layer — always fully
     closed, crisp (no hand-drawn wobble), with a slight rounding. Shapes are
     clean by design; the hand-drawn feel is reserved for TEXT only. */
  .hf-box::before, .hf-circle::before {
    content: "";
    position: absolute;
    inset: 0;
    border: var(--hf-bw) solid currentColor;
    pointer-events: none;
  }
  .hf-box::before { border-radius: 14px; }
  .hf-circle::before { border-radius: 50%; }
  /* Text lines inside a shape never wrap mid-word and never touch the border. */
  .hf-box > *, .hf-circle > * {
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
    max-width: 100%;
  }
</style>`
}

/**
 * Ensure the shape primitive is present in the HTML. Idempotent — if a scene
 * already contains our style id we leave it alone. Injected right after the
 * opening <body> so its rules sit after Claude's <head> styles and win the
 * cascade for the .hf-box / .hf-circle classes at equal specificity.
 */
export function injectShapeAssets(html: string): string {
  if (html.includes(`id="${SHAPE_STYLE_ID}"`)) return html
  const assets = shapeCss()
  const bodyOpen = /<body\b[^>]*>/i.exec(html)
  if (bodyOpen) {
    const at = bodyOpen.index + bodyOpen[0].length
    return html.slice(0, at) + '\n' + assets + '\n' + html.slice(at)
  }
  // No <body> (shouldn't happen for a valid doc) — fall back to before </html>.
  const closeHtml = html.lastIndexOf('</html>')
  if (closeHtml >= 0) return html.slice(0, closeHtml) + assets + '\n' + html.slice(closeHtml)
  return html + assets
}

/**
 * Instruction block appended to the 9:16 generation prompt. Tells Claude to use
 * the provided primitive for ANY boxed/circled content and never to hand-draw a
 * box with SVG strokes or absolutely-positioned text.
 */
export function shapeGuideForPrompt(): string {
  return `SHAPES WITH TEXT (boxes & circles) — use the SYSTEM-PROVIDED primitive, do NOT hand-draw:

  The runtime injects a guaranteed-correct shape stylesheet. For ANY rectangle/box
  or circle that contains text, you MUST use these classes and put the text INSIDE
  as child elements. This makes the outline always fully closed (all 4 sides / a
  full circle) and makes text overlap impossible.

  RECTANGLE / BOX:
    <div class="hf-box" style="color:#5BC8F5;">
      <div style="color:#FFFFFF;">Tier 1  =  ALL students</div>
      <div style="color:#FFFFFF;">Tier 2  =  SOME students</div>
      <div style="color:#FFFFFF;">Tier 3  =  FEW students</div>
    </div>
    - color on .hf-box sets the OUTLINE color. Each child sets its own text color.
    - The box auto-sizes around the lines with built-in padding — text can never
      touch the outline. Add more child <div> lines for more rows.

  CIRCLE (fixed 360px diameter — put only a SHORT word or 1–2 word phrase inside):
    <div class="hf-circle" style="color:#5BC8F5;">
      <div style="color:#F5C842;">TARGET?</div>
    </div>
    - color on .hf-circle sets the OUTLINE color; the child sets the text color.
    - Keep the inner text short AND size the font so the text stays roughly ≤ 300px
      wide, leaving clear space between the text and the round outline on every side
      (never let the text touch or crowd the circle). For longer content use a box.

  HARD RULES:
    - Shapes are CLEAN, not hand-drawn. The outline is a crisp CSS border. Do
      NOT try to make the box/circle look hand-drawn, wobbly, or sketchy. The
      hand-drawn marker style is for TEXT only.
    - NEVER draw a box outline with an SVG <rect>/<path> stroke or a
      stroke-dashoffset write-on. That is the #1 cause of "one side missing".
      Use .hf-box / .hf-circle instead — the border is a CSS border and is
      always closed.
    - NEVER absolutely-position text on top of a separately-drawn box. Text goes
      INSIDE .hf-box / .hf-circle as child elements, in normal flow.
    - REVEAL ORDER: reveal the shape FIRST (fade/scale the .hf-box or .hf-circle
      element itself, opacity 0→1), THEN reveal its inner text lines ONE AFTER
      ANOTHER with staggered start times — never all inner lines at once, and
      never the text at the same instant as the shape. Do NOT animate a stroke
      to "draw" the outline.
    - Every reveal plays ONCE and holds. No pulsing/looping the shape or its text.
    - Keep a box within the safe width — the primitive caps at 900px; if your
      text is longer, reduce the child font-size so it fits on one line.
    - SHAPE PLACEMENT: a shape is TALLER than one text band. Do NOT put a
      .hf-box or .hf-circle inside a fixed-height band row, and NEVER wrap it in
      a container with overflow:hidden or a fixed height that could clip it — that
      makes the shape collapse or vanish. Place the shape centered in the vertical
      MIDDLE of the safe area, as a direct child of .safe (or a wrapper with no
      height limit and no overflow clipping), free to take its full height. The
      band names position TEXT LINES; a shape occupies the center and may span the
      height of about two bands.
    - AN EMPTY BOX IS A FAILURE. If you use a .hf-box / .hf-circle, it MUST end
      with its text fully visible inside. If you can't reliably get text to
      reveal inside a box, use PLAIN TEXT LINES instead — a correct plain-text
      scene always beats an empty box.

EXPLAINER GRAPHICS (optional — use these to make scenes more creative & clear):
  You are NOT limited to boxes. To explain or emphasize, you MAY add small
  graphic elements — as long as each reveals ONCE and HOLDS (never loops):
    - Marks & icons: check mark (✓), cross (✗), arrow (→ ↘ ↓), star (★),
      plus/minus, a short underline or divider, a bullet dot, a simple circle
      or highlight ring around a word.
    - Simple diagrams / flows: 2–4 short labels connected by arrows, a small
      step flow (A → B → C), a simple two-item comparison. Keep it clean,
      legible, and uncluttered.
    - A shape used WITHOUT text inside, purely as an explainer object (e.g. an
      arrow pointing from one line to another, a circle ringing a key word, a
      check mark beside a correct item). These do NOT count as "empty boxes" —
      the empty-box rule is only about .hf-box / .hf-circle text containers.
  RELIABILITY RULES for any graphic:
    - Reveal once and hold. If you animate an SVG stroke (check mark, arrow,
      underline), the FINAL stroke-dashoffset MUST reach 0 (fully drawn),
      finishing by D − 0.3s. Never loop, pulse, or blink it.
    - Prefer small, self-contained SVG icons or simple CSS shapes. Draw marks
      with an SVG <path> (a check mark is "M x1 y1 L x2 y2 L x3 y3"); an arrow
      is a line plus a small arrowhead. Keep them modest in size so they never
      crowd the text.
    - Text INSIDE a box/circle still uses .hf-box / .hf-circle (never an
      SVG-stroked rectangle around text). SVG strokes are fine for the marks
      and connectors above, which contain no text.
    - Every graphic stays inside the safe area and is fully visible & static at
      the end.`
}
