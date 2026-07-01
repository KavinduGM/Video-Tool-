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
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 60px;
    aspect-ratio: 1 / 1;
  }
  /* The outline. A CSS border on a full-inset layer — always fully closed. */
  .hf-box::before, .hf-circle::before {
    content: "";
    position: absolute;
    inset: 0;
    border: var(--hf-bw) solid currentColor;
    filter: url(#hf-rough);  /* hand-drawn wobble on the border only */
    pointer-events: none;
  }
  .hf-box::before { border-radius: 18px 12px 20px 10px; }
  .hf-circle::before { border-radius: 50%; }
  /* Text lines inside a shape never wrap mid-word and never touch the border. */
  .hf-box > *, .hf-circle > * {
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
    max-width: 100%;
  }
</style>
<svg id="hf-shape-defs" aria-hidden="true" width="0" height="0" style="position:absolute">
  <defs>
    <filter id="hf-rough" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>`
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

  CIRCLE:
    <div class="hf-circle" style="color:#F5C842; width:520px;">
      <div style="color:#FFFFFF;">Core Idea</div>
    </div>

  HARD RULES:
    - NEVER draw a box outline with an SVG <rect>/<path> stroke or a
      stroke-dashoffset write-on. That is the #1 cause of "one side missing".
      Use .hf-box / .hf-circle instead — the border is a CSS border and is
      always closed.
    - NEVER absolutely-position text on top of a separately-drawn box. Text goes
      INSIDE .hf-box / .hf-circle as child elements, in normal flow.
    - To animate a box in, fade/scale the .hf-box element itself (opacity 0→1);
      do NOT animate a stroke to "draw" the outline.
    - Keep a box within the safe width — the primitive caps at 900px; if your
      text is longer, reduce the child font-size so it fits on one line.`
}
