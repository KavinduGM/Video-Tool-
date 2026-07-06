import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs/promises'
import type { AspectRatio, ScriptSpec } from '@shared/types'
import { dimensionsForRatio } from './parser'
import { zoneGuideForPrompt, zoneGuideForReviewer, NINE_SIXTEEN } from '@shared/zones'
import { measureSafeZone, fitHtmlToSafeZone, safeZoneFeedback, overlapFeedback, emptyShapeFeedback } from './safezone'
import { SAFE_AREA } from '@shared/zones'

// A measured 9:16 scene whose content box spans less than this fraction of the
// safe-area height reads as sparse/cheap (a small cluster floating in darkness)
// — the user rejects these frames, so the gate regenerates with scale-up feedback.
const MIN_VERTICAL_FILL = 0.62
import { injectShapeAssets, shapeGuideForPrompt } from './shapes'
import { buildAnimatedCardHtml } from './cards'
import { buildStoryCardHtml, type StorySet } from './storycards'

export interface SceneRenderArgs {
  apiKey: string
  model: string
  ratio: AspectRatio
  durationSeconds: number
  sceneIndex: number
  totalScenes: number
  explainer: string
  voiceover: string
  style?: ScriptSpec['style']
  /**
   * Issues raised by the visual reviewer on a previous render of THIS scene.
   * When present, the prompt prepends them so Claude knows what to fix.
   */
  visualFeedback?: string[]
  /** 'scene' (hand-drawn, default) or a professional typographic 'intro'/'outro' card. */
  mode?: 'scene' | 'intro' | 'outro'
  /** For intro/outro: the on-screen text to typeset (one headline per line). */
  onScreen?: string
}

const SYSTEM_PROMPT = `You are an expert motion-graphics engineer who writes self-contained HTML compositions for the HeyGen Hyperframes renderer.

Hyperframes renders an "index.html" with a #stage element to MP4 frame-by-frame.
The stage MUST declare data-width and data-height matching the target resolution.
Elements inside the stage can use data-start and data-duration (in seconds) to schedule timed entry,
or you may drive everything with GSAP / CSS keyframes / anime.js — whichever you prefer.

Hard requirements you MUST follow:

1. Output EXACTLY one complete HTML document beginning with <!DOCTYPE html>. No markdown fences, no commentary, no preamble.

2. The <body> contains exactly one root:
   <div id="stage" data-composition-id="main" data-width="W" data-height="H" data-duration="D">…</div>
   where W, H, D are filled with the exact values the user requests.

3. All CSS must be inline in a <style> block. All JS must be inline in a <script> block.
   External references are allowed ONLY for CDN imports of animation libraries (gsap, anime.js, lottie-web)
   and Google Fonts. Prefer GSAP timelines for complex sequencing.

4. THE TIMELINE IS A SINGLE LINEAR PLAYTHROUGH FROM 0 TO D SECONDS. ABSOLUTELY NO LOOPING.
   This rule is enforced by a post-processor that rewrites the following patterns — do not
   write them, you'll just look careless:
   - CSS:        \`animation-iteration-count: infinite\` or any value > 1 (will be forced to 1)
   - CSS:        \`animation: name 2s infinite\` (the \`infinite\` keyword will be stripped)
   - GSAP:       \`repeat: -1\` or \`repeat: N\` > 0 (will be forced to 0)
   - GSAP:       \`yoyo: true\` (will be forced to false)
   - SVG:        \`<animate ... repeatCount="indefinite">\` or repeatCount > 1 (will be forced to "1")
                 (same for \`<animateMotion>\`, \`<animateTransform>\`)
   - WebAnims:   \`element.animate(..., { iterations: Infinity })\` or iterations > 1 (forced to 1)
   - anime.js:   \`loop: true\`, \`loop: -1\`, or \`loop: N\` > 0 (will be forced to false)
   - JS:         \`setInterval\` for any visible animation — banned outright; use
                 \`setTimeout\` only for scheduling one-shot reveals.

   Every \`@keyframes\` rule applied to a visible element MUST be paired with
   \`animation-iteration-count: 1\` and \`animation-fill-mode: forwards\` explicitly. Do NOT
   rely on defaults. Every animation runs exactly once and ends in its final visual state.

   RECOMMENDED write-on patterns (use these, they don't loop):
   - SVG hand-drawn stroke write-on: set \`stroke-dasharray: <pathLength>; stroke-dashoffset: <pathLength>;\`
     and animate \`stroke-dashoffset: 0\` with a single \`forwards\` CSS keyframe or one GSAP tween.
   - Letter-by-letter text write-on: ONLY for SHORT headings/titles (≤ ~24 characters). Stagger
     each <span> with a GSAP timeline (no repeat) or CSS \`@keyframes\` with per-letter
     \`animation-delay\`, \`animation-iteration-count: 1\`.
   - Body / supporting lines (anything longer than a short heading): animate the WHOLE LINE as a
     single element — one fade-in or one left-to-right clip/wipe reveal per line. Do NOT split long
     body lines into per-letter spans. Per-letter on every line explodes the DOM and the output
     size, which causes the document to get truncated and only the first element to render. When a
     style hint says "all text writes in letter by letter", interpret it as: headings type on
     letter-by-letter, and body lines write on smoothly as a single quick reveal — the viewer reads
     this as the same hand-drawn feel without the cost.

5. THE ANIMATION MUST GENUINELY FILL THE ENTIRE DURATION D WITH UNIQUE, PROGRESSIVE CONTENT.
   This is the single most important rule and the one most often violated:
   - Plan AT LEAST ceil(D / 2.5) distinct "beats" spread across [0, D]. A beat is a moment where
     a new element appears, an existing element transforms meaningfully, or focus shifts.
   - At no point should there be a static hold longer than 1.5 seconds in the first 90% of the
     duration. Every 1.5–3 second window must either reveal something new or progress something
     visibly (e.g. a sub-bullet writes in, a value counts up, a shape morphs).
   - The composition is NOT a 3-second loop padded to D seconds. If you find yourself with
     extra time to fill, ADD MORE CONTENT — sub-points, supporting visuals, callouts,
     a punctuating shape, a soft camera-style pan — not a repeat of what came before.
   - The final 0.5–1.5 seconds is a "settle" hold where everything sits stable. During this hold
     you MAY apply ONE subtle, single-pass tween (a slow zoom, a slow pan, a very slow gradient
     drift) lasting exactly until D seconds, to keep the frame alive — but it must NOT repeat
     and must NOT distract from the final composition.

5c. EVERY ANIMATION MUST COMPLETE WITHIN THE TIMELINE — start_time + duration ≤ D − 0.3 seconds.
    This is the single biggest cause of "faded text" / "half-drawn box" defects.

    Hyperframes renders exactly D seconds of video, then hard-stops. ANY animation still in
    progress at t = D is FROZEN at whatever partial state it had reached. A "write-in" tween
    that's only 40% complete leaves the text at 40% opacity. A box stroke-dashoffset animation
    that's only 70% done leaves one side of the box missing.

    Worked example of the failure mode (DO NOT do this):
      Scene duration D = 8.0s.
      You schedule a text write-in: start 7.0s, duration 1.8s.
      Math: this animation ends at 8.8s, which is AFTER D. The renderer hard-stops at 8.0s,
      so the text only finishes 56% of its write-in. The final frame shows dim/faded letters.

    Correct version of the same item:
      Scene duration D = 8.0s. Budget = D − 0.3 = 7.7s for animation completion.
      Schedule it at start 6.2s, duration 1.5s → ends at 7.7s ≤ 7.7s. ✓
      The final 0.3s is the settle hold where everything sits fully drawn and fully opaque.

    Concrete constraints you must verify for EVERY animated element:
      - CSS:  delay + animation-duration   ≤  D − 0.3
      - GSAP: position + vars.duration     ≤  D − 0.3
      - SVG:  begin + dur                  ≤  D − 0.3
      - Web Animations / anime.js: delay + duration ≤ D − 0.3 (in seconds)
    If you can't make an animation fit, SHORTEN its duration — never push the start earlier
    than D − 2.0 (that would compress the timeline and re-trigger rule 5b).

5b. ONE DOM ELEMENT PER VISIBLE ITEM. ONE ANIMATION PER ELEMENT.
    This is the single biggest source of "the scene loops" failures.

    The explainer lists STEPS. A step often describes MULTIPLE visible items.
    Examples:
      "Step 8: three white bullets write in one after another:
                'Identifies the disease'
                'Looks at the PRESENT'
                'e.g. Stage 3 Lung Cancer'"
      → That is THREE separate DOM elements with THREE separate, staggered animations,
        not one element containing all three lines, and not three elements that animate
        at the same time.

      "Step 6: a hand-drawn box strokes in, then sky-blue text writes in, then a
                phrase writes in beside it"
      → That is THREE separate animations on three separate elements: the box's
        stroke-dashoffset reveal, then the text write-on, then the phrase write-on.

    PLANNING CHECKLIST you must satisfy before writing HTML:
    (a) Count every distinct visible item described across all steps (boxes, lines, labels,
        bullets, sub-bullets, doodles, headings, underlines). Call this N.
    (b) You will create N DOM elements, each with its own animation and its own
        start-time / delay.
    (c) Distribute those N animation start times across the full duration D so that:
          - The FIRST animation starts at or near t = 0.
          - The LAST animation starts no earlier than t = D − 2.0 seconds.
          - No gap longer than 1.5 seconds between consecutive animation start times
            during the first 90% of the timeline.
    (d) Within a step that lists "one after another" items, stagger them — never reveal
      them simultaneously.

    If timestamps appear in the explainer (Step N (a–b s):), honor them as a hard contract.
    If they don't, derive your own start times satisfying (c) above. Either way, the
    LATEST start time you assign to any element MUST be ≥ D − 2.0 seconds.

    Every element's INITIAL CSS state must be the pre-reveal state (opacity: 0,
    stroke-dashoffset = path length, off-screen transform). Otherwise the element shows
    at frame 0 and the "reveal" is a no-op.

    Pick whichever animation technique fits — GSAP timeline with absolute time positions,
    CSS \`@keyframes\` with per-element \`animation-delay\` (plus \`animation-iteration-count: 1\`
    and \`animation-fill-mode: both\`), or anime.js with delay. The key is one element per
    item and start times that span the full duration.

6. THE EXPLAINER OFTEN CONTAINS MULTIPLE SECTIONS OR BEATS. Map them onto the sequential timeline:
   - Identify each distinct beat in the explainer (e.g. "OPENING", "SECTION 1", "SECTION 2", "CLOSING").
   - Divide the duration D between them in proportion to how much content each beat carries.
   - Each beat occupies a CONTIGUOUS, NON-OVERLAPPING time block. Beat N+1 starts only after Beat N
     has fully revealed (allow a brief 0.3–0.6s crossfade between beats if it improves polish).
   - Within a beat, elements can stagger in, but the beat's last element must finish before the
     next beat begins. Earlier beats' elements either remain on stage or are explicitly
     transitioned out (fade/slide/clear) before the next beat's content appears.

7. The total visible animation MUST end exactly at D seconds. No awkward freezes longer than the
   settle hold described in rule 5. No abrupt cuts, no dead space at the end.

8. Do NOT include <audio> or <video> tags. Audio is added separately by the host pipeline.

9. The stage must fully fill its declared dimensions. Use a solid background color (do not rely on transparency).

10. Use modern, polished motion design: smooth easing, layered reveals, balanced typography.
    Respect the requested style hints (description, colors, fonts) faithfully — if "hand-drawn"
    is requested, use rough strokes, jitter, write-on SVG paths. If "minimal" is requested, restrain motion.

11. Use system-safe fonts or Google Fonts loaded via <link>. If a font is named in the style hints,
    prefer it and load it via Google Fonts if it exists there.

12. Animations must be DETERMINISTIC — no Math.random() driving visible motion. The same input must
    render the same output every time.

13. Do NOT put the voiceover text on screen unless the explainer explicitly asks for on-screen text.
    The voiceover is a separate audio track played alongside.

14. LAYOUT — NO ELEMENT MAY VISUALLY OVERLAP ANOTHER. This is a HARD requirement.

    The stage is a single fixed-size canvas. Structure it as a vertical flex column with
    distinct, non-overlapping REGIONS, each region containing exactly the content that
    belongs there. Typical structure for a portrait scene:

        #stage {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          padding: 80px 60px;  /* breathing room around the edges */
          gap: 40px;           /* spacing between major regions */
          box-sizing: border-box;
        }

        .region-top    { /* heading + underline */ }
        .region-body   { flex: 1; display: flex; ... ; gap: 24px; }
        .region-bottom { /* annotations / footer */ }

    HARD RULES for layout:

    a) Prefer NORMAL FLOW with flexbox or grid for all positioning. Use \`position: absolute\`
       ONLY for hand-drawn doodles or accent overlays that genuinely need to float on top of
       another element — and even then, make sure they don't cover important text.

    b) "Two pieces of text side by side" = flex row container with the two pieces as children,
       NOT two absolutely-positioned elements. The same goes for "left box and right box",
       "icon next to label", "label above arrow", etc.

    c) When the explainer says one element is BELOW another, they must be siblings in DOM
       order with the lower one appearing after, in a flex column or in normal flow.
       Never absolutely-position the lower element with a fixed top: value that depends on
       the upper element's size.

    d) Inside a box that holds multiple text pieces, the box must use flex (column or row,
       whichever matches "side by side" vs "stacked") with proper gap. The text pieces are
       children of the box, in flow, NOT absolutely positioned inside the box.

    e) Dividers, separators, dashed lines, and timeline arrows are siblings of the things they
       separate, with explicit height/width that matches what they actually need to span.
       A vertical divider between two columns should be a flex item between those columns,
       not an absolutely-positioned line that extends past the columns into other regions.

    f) Bottom annotations and footers belong in their own region at the bottom of the stage.
       They appear after the main body region in DOM order. They must NEVER overlap with
       content above them.

    g) Reserve generous gaps between regions and between sibling elements. Minimum 20px gap
       between adjacent content elements. Minimum 40px gap between major regions.

    h) Before submitting, mentally render the final composition. If two visible elements
       occupy overlapping screen rectangles when their animations finish, the layout is wrong
       — rework it with proper flex/grid structure.

    i) NEVER BREAK A WORD ACROSS TWO LINES. This is a HARD requirement — a word like "Supports"
       must never render as "S" on one line and "upports" on the next, and "students" must never
       split into "st" / "udents". Each labeled text line from the explainer (the quoted strings)
       must sit on ONE visual line. Enforce ALL of these on every text element:
         - \`white-space: nowrap;\`            (the line never wraps at all)
         - \`overflow-wrap: normal;\`          (never break inside a word)
         - \`word-break: keep-all;\`           (never break inside a word)
       Then make the line FIT the frame width. The usable width is the stage width minus the
       horizontal padding on both sides. Choose a font-size such that the LONGEST single line in
       the scene fits within that usable width. When in doubt, pick a smaller font-size — a
       readable line that fits is always better than a large line that wraps or clips.
       Rough budget for a 1080-px-wide portrait stage with ~60px side padding (≈960px usable):
       a handwriting font at ~48–60px comfortably fits ~30–38 characters per line; if your
       longest line is longer than that, drop the font-size accordingly. If a single line is
       genuinely too long to fit at a reasonable size, you MAY reduce only that line's font-size,
       but it still must stay on one line with the rules above.

    j) Keep every line within the horizontal safe area — text must not touch or run off the left
       or right edges. Maintain the side padding from rule 14's stage example.

15. SHAPE INTEGRITY — geometric shapes must be COMPLETE.
    Every rendered shape is reviewed by an automated visual reviewer that rejects partial
    shapes. To pass review:

    a) RECTANGLES / BOXES: all 4 sides must connect end-to-end. Never render a "3-sided box"
       or a rectangle with a visible gap on one edge. Use ONE of these patterns:
         - A plain HTML element with \`border: 3px solid <color>\` (border-radius optional
           for slightly rounded hand-drawn feel). The browser will always close the rectangle.
         - An SVG \`<rect>\` element with stroke. Animate the stroke-dashoffset for a write-on
           effect, but the FINAL stroke-dashoffset must reach 0 so the full perimeter is
           visible by the end of the reveal.
         - An SVG \`<path>\` that traces all 4 sides and ends with \`Z\` to close the path.
           Set stroke-dasharray = path-length and animate stroke-dashoffset from path-length
           to 0. DOUBLE-CHECK that the dash-array equals the actual path length, so the
           stroke finishes drawing all 4 sides.

    b) TRIANGLES: all 3 sides connected, path closed with \`Z\` if SVG, or use clip-path
       polygon with a solid border via a wrapping technique.

    c) CIRCLES / ELLIPSES: fully closed. Use \`<circle>\` or \`<ellipse>\` (SVG always closes
       these). For a stroke-on animation, animate stroke-dashoffset → 0 so the full perimeter
       is drawn.

    d) LINES, ARROWS, DIVIDERS, DASHED CONNECTORS: drawn end-to-end. The final stroke-dashoffset
       must be 0. The arrowhead (if any) must be visible at the line's endpoint.

    Common bug to avoid: setting stroke-dasharray and stroke-dashoffset to values that don't
    leave the shape fully drawn at the end. If you compute the path length wrong, the stroke
    will stop short and leave one side missing.

16. HAND-DRAWN APPEARANCE — when "hand-drawn" is in the style, you may add slight stroke
    jitter / variation, but completeness comes first. A perfectly straight box is better
    than a 3-sided "hand-drawn" box. Use small roughness (1-2px wobble at most), not
    full broken-line effects.`

// ====================================================================
// INTRO / OUTRO — a professional TYPOGRAPHIC title card (NOT hand-drawn).
// Solid light background, bold sans-serif, letter-by-letter reveal with a
// word-by-word highlight sweep behind key words.
// ====================================================================
const INTRO_OUTRO_SYSTEM = `You are an expert motion-graphics engineer writing a single self-contained HTML composition for the HeyGen Hyperframes renderer. This one is a POLISHED TYPOGRAPHIC TITLE CARD (an intro or outro), NOT a hand-drawn scene.

Hyperframes renders "index.html" (a #stage element) to MP4 frame-by-frame.

STRUCTURE (same hard requirements as always):
1. Output EXACTLY one complete HTML document starting with <!DOCTYPE html>. No markdown, no commentary.
2. The <body> has exactly one root: <div id="stage" data-composition-id="main" data-width="W" data-height="H" data-duration="D">…</div> with the exact W, H, D given.
3. All CSS inline in <style>, all JS inline in <script>. CDN imports allowed ONLY for animation libs (gsap) and Google Fonts.
4. ONE LINEAR PLAYTHROUGH FROM 0 TO D. NO LOOPING: no animation-iteration-count>1 / infinite, no GSAP repeat/yoyo, no setInterval for visible motion. Every animation runs ONCE and holds its final state (animation-fill-mode: both / forwards). At t=D everything sits fully visible and still.
5. Every animation must FINISH by D − 0.3s (start + duration ≤ D − 0.3). Nothing may be mid-animation at the end.
6. Deterministic — no Math.random() driving visible motion.
7. Do NOT include <audio>/<video> tags. The stage fully fills its dimensions with a SOLID background.

TYPOGRAPHIC STYLE (this is the look — make it BIG and BOLD, never sparse):
- SOLID light background — a warm neutral (e.g. #F4EFE6 / #F5F1EA). Never black, never a gradient-heavy look.
- Text is a BOLD professional SANS-SERIF loaded from Google Fonts — use "Poppins" (weights 700–900) (or Montserrat/Archivo). Load via <link>. This is NOT hand-drawn — no marker/handwriting fonts.
- Near-black text (e.g. #1A1A1A). Choose ONE soft accent HIGHLIGHT color (e.g. a muted coral #F3A79B or soft peach/yellow) used only for the highlight behind key words.
- SIZE — this is the biggest fix: the headline is the HERO and must DOMINATE the frame. Make it LARGE — the longest line should nearly fill the safe width (aim for lines ~820–940px wide on this 1080-wide canvas), which is typically a font-size around 96–140px with font-weight 800–900 and a tight line-height (~1.03–1.1). Do NOT leave the frame looking mostly empty; if it looks small or sparse, INCREASE the font-size until the block fills the middle of the frame. Never break a word across lines — reduce the size only if a word would break.
- LAYOUT — center the whole block (kicker + headline) VERTICALLY in the safe area so it's balanced, not clustered high or to one side. Center-align the lines. A short UPPERCASE letter-spaced kicker/label above the headline (in the accent color, ~28–36px) adds polish. You MAY add one small accent detail (a short underline bar or a couple of the words set in the accent color) for visual interest — keep it tasteful.

THE ANIMATION — reveal WORD BY WORD (this is required for reliability):
- Wrap EACH WORD of EVERY line in its own <span class="word"> (do NOT split into per-letter spans — per-letter on multi-line text is fragile and drops lines). Reveal the words ONE AFTER ANOTHER in reading order, each fading/rising in once (opacity 0→1, small y settle, ~0.35s), staggered across the duration and ALL finishing by D − 0.3s. Use a GSAP timeline or CSS per-word animation-delay with iteration-count:1 and fill both.
- BUILD EVERY WORD OF EVERY LINE. All lines of the on-screen text must be present and fully visible at the end — never render only the first line. Keep the document compact (word spans, not letter spans) so nothing is truncated.
- WORD HIGHLIGHT: 1–3 KEY words get a rounded highlight block BEHIND them (a pseudo-element or absolutely-positioned rounded rect, border-radius ~12px, the accent color, ~0.85 opacity). Each highlight SWEEPS IN (scaleX 0→1 from the left, ~0.3s) right as that word appears — word by word, in reading order. The word's text sits ABOVE its highlight (z-index) and stays readable. The highlight box must sit snugly around the word (a little horizontal padding), not oversized.
- Order: the kicker fades in first, then the headline words reveal in sequence, highlights landing with their words. Everything settled and STILL through D. No looping, no re-typing.

LAYOUT / SAFE ZONE: obey the 9:16 safe-zone contract given in the user message — all text inside the safe area, nothing cropped, no word broken across lines.

Return ONLY the full HTML document, beginning with <!DOCTYPE html>.`

function buildIntroOutroPrompt(args: SceneRenderArgs): string {
  const dims = dimensionsForRatio(args.ratio)
  const kind = args.mode === 'outro' ? 'OUTRO' : 'INTRO'
  const zoneBlock = args.ratio === '9:16' ? `\n${zoneGuideForPrompt(args.durationSeconds)}\n` : ''
  return `Build a single Hyperframes ${kind} title card (professional typographic style).

Aspect ratio: ${args.ratio}
Resolution: ${dims.width}x${dims.height}
Total duration (seconds): ${args.durationSeconds.toFixed(3)}
${zoneBlock}
ON-SCREEN TEXT — typeset EXACTLY this text (one headline line per line below). Do not add or change words:
"""
${args.onScreen ?? ''}
"""

The voiceover playing over this card (for pacing only — do NOT put it on screen unless it matches the on-screen text):
"""
${args.voiceover}
"""

Design it as described in the system prompt:
- BIG, BOLD Poppins headline that DOMINATES the frame (longest line ~820–940px wide, font-size ~96–140px, weight 800–900). Do not leave the frame mostly empty.
- The kicker + headline block CENTERED vertically in the safe area (balanced, not clustered up top).
- Reveal WORD BY WORD (each word its own span, no per-letter spans), all words finishing by ${(args.durationSeconds - 0.3).toFixed(2)}s, with a rounded accent HIGHLIGHT sweeping in behind 1–3 KEY words as they land.
- EVERY line of the on-screen text must be fully built and visible at the end — do not render only the first line. Everything settled and still at the end.
- All text inside the safe area, no word broken across lines.

Return ONLY the full HTML document, beginning with <!DOCTYPE html>.`
}

/**
 * A deterministic, guaranteed-safe STATIC intro/outro card — no Claude, no
 * animation. Every line is centered and visible for the whole duration, so it
 * physically cannot loop or come up incomplete. Used as the fallback when the
 * animated version can't be produced cleanly.
 */
function buildStaticCardHtmlRaw(onScreen: string, durationSeconds: number): string {
  const m = NINE_SIXTEEN.margin
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = onScreen
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const items = lines.map((l) => `      <div class="line">${esc(l)}</div>`).join('\n')
  const d = durationSeconds.toFixed(3)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#F4EFE6;font-family:'Poppins',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;gap:26px}
  .line{color:#1A1A1A;font-weight:800;font-size:66px;line-height:1.14;text-align:center;overflow-wrap:normal;word-break:keep-all;max-width:100%}
  .line:first-child{color:#C2554B}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${d}">
  <div class="safe">
${items}
  </div>
</div>
</body>
</html>`
}

/**
 * The deterministic 2-scene STORY template card (storyboard style: badge +
 * hook + hero image → statement + image / CTA) — built entirely in code by
 * storycards.ts, then run through the safe-zone fit. Never throws for
 * content reasons; throws only when scene texts are missing.
 */
export async function buildStoryIntroOutroCard(args: {
  kind: 'intro' | 'outro'
  scene1: string
  scene2: string
  badge?: string
  subscribe?: boolean
  durationSeconds: number
  set: StorySet
  images?: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>>
  backdrops?: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>>
  highlight?: string[]
}): Promise<string> {
  // NO safe-zone fit here: story-card heroes INTENTIONALLY bleed off the
  // frame edges and into the bottom margin (that's the storyboard design),
  // which the fitter reads as overflow — it would shrink and re-center the
  // whole card. Text safety comes from the conservative size tiers and the
  // per-card layout paddings instead.
  return buildStoryCardHtml({
    kind: args.kind,
    scene1: args.scene1,
    scene2: args.scene2,
    badge: args.badge,
    subscribe: args.subscribe,
    durationSeconds: args.durationSeconds,
    set: args.set,
    images: args.images,
    backdrops: args.backdrops,
    highlight: args.highlight
  })
}

/**
 * The deterministic ANIMATED intro/outro card (word-by-word reveal, exam-name
 * highlight sweep, optional subscribe CTA) — built entirely in code by
 * cards.ts, then run through the safe-zone fit so long lines can never crop.
 * Never throws for content reasons.
 */
export async function buildAnimatedIntroOutroCard(args: {
  onScreen: string
  durationSeconds: number
  highlights?: string[]
  subscribe?: boolean
  seed: string
}): Promise<string> {
  let html = buildAnimatedCardHtml({
    onScreen: args.onScreen,
    durationSeconds: args.durationSeconds,
    highlights: args.highlights,
    subscribe: args.subscribe,
    seed: args.seed
  })
  try {
    const measurement = await measureSafeZone(html, args.durationSeconds)
    if (measurement.measured && !measurement.ok) {
      const fit = fitHtmlToSafeZone(html, measurement)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* best-effort — the raw card is conservatively sized */
  }
  return html
}

/** Force the #stage data-duration to a specific value (first occurrence). */
export function patchStageDuration(html: string, durationSeconds: number): string {
  return html.replace(
    /(\bdata-duration\s*=\s*["'])[\d.]+(["'])/,
    `$1${durationSeconds.toFixed(3)}$2`
  )
}

function hexLuma(hex: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

/**
 * The DISPLAY lines of a scene: quoted strings that stand alone on their own
 * line in the explainer (the script format puts every on-screen line on its
 * own indented line). Inline emphasis quotes ("with the word \"inside\" in
 * cyan") are deliberately NOT matched — they are styling notes, not lines.
 */
export function extractDisplayLines(explainer: string): string[] {
  return Array.from(explainer.matchAll(/^\s*"([^"\n]{2,80})"\s*$/gm))
    .map((m) => m[1].trim())
    .filter(Boolean)
}

function normalizeForCoverage(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[\s ]+/g, '')
}

/**
 * Deterministic TEXT-COVERAGE check: which of the explainer's display lines
 * are missing from the HTML entirely? Whitespace-insensitive and tag-blind, so
 * letter-by-letter span markup still matches. A line missing here was never
 * authored — no animation fix can reveal it.
 */
export function missingDisplayLines(explainer: string, html: string): string[] {
  const lines = extractDisplayLines(explainer)
  if (lines.length === 0) return []
  const hay = normalizeForCoverage(html)
  return lines.filter((l) => !hay.includes(normalizeForCoverage(l)))
}

/**
 * A deterministic, guaranteed-safe STATIC SCENE card — the last resort when the
 * animated scene still LOOPS after every repair attempt. It extracts the quoted
 * on-screen lines from the explainer and renders them stacked and centered in
 * the scene's own palette and handwriting font, held for the whole duration.
 * No animation → physically cannot loop. Returns null when the explainer has no
 * quoted lines to show.
 */
export async function buildStaticSceneCard(
  explainer: string,
  style: ScriptSpec['style'] | undefined,
  durationSeconds: number
): Promise<string | null> {
  const lines = extractDisplayLines(explainer).slice(0, 8)
  if (lines.length === 0) return null

  const colors = (style?.colors ?? []).filter((c) => hexLuma(c) !== null)
  // Background: the first dark color in the palette (scenes use dark canvases).
  const bg = colors.find((c) => (hexLuma(c) as number) < 80) ?? '#000000'
  const bgLuma = hexLuma(bg) as number
  // Accent for the heading: a palette color that clearly separates from the
  // background and isn't near-white (that's the body color's job).
  const accent =
    colors.find(
      (c) => c !== bg && Math.abs((hexLuma(c) as number) - bgLuma) > 90 && (hexLuma(c) as number) < 230
    ) ?? '#F5C842'
  const fontName = style?.fonts?.[0] ?? 'Caveat'
  const fontParam = fontName.trim().replace(/\s+/g, '+')

  const m = NINE_SIXTEEN.margin
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const items = lines
    .map((l, i) => `      <div class="line${i === 0 ? ' head' : ''}">${esc(l)}</div>`)
    .join('\n')
  const d = durationSeconds.toFixed(3)
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${bg};font-family:'${fontName}',cursive}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;gap:44px}
  .line{color:#FFFFFF;font-weight:700;font-size:58px;line-height:1.2;text-align:center;white-space:nowrap;overflow-wrap:normal;word-break:keep-all;max-width:100%}
  .head{color:${accent};font-size:84px}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${d}">
  <div class="safe">
${items}
  </div>
</div>
</body>
</html>`
  try {
    const measurement = await measureSafeZone(html, durationSeconds)
    if (measurement.measured && !measurement.ok) {
      const fit = fitHtmlToSafeZone(html, measurement)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* best-effort — the raw card is conservatively sized */
  }
  return html
}

/**
 * Build the static card and run it through the deterministic safe-zone fit so it
 * is guaranteed to sit inside the safe area even if a line is long. Never throws.
 */
export async function buildStaticIntroOutroCard(onScreen: string, durationSeconds: number): Promise<string> {
  let html = buildStaticCardHtmlRaw(onScreen, durationSeconds)
  try {
    const m = await measureSafeZone(html, durationSeconds)
    if (m.measured && !m.ok) {
      const fit = fitHtmlToSafeZone(html, m)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* fit is best-effort; the raw card is already conservatively sized */
  }
  return html
}

function buildUserPrompt(args: SceneRenderArgs): string {
  if (args.mode === 'intro' || args.mode === 'outro') return buildIntroOutroPrompt(args)
  const dims = dimensionsForRatio(args.ratio)
  const style = args.style
    ? `\nStyle hints:\n- description: ${args.style.description ?? '(none)'}\n- colors: ${(args.style.colors ?? []).join(', ') || '(none)'}\n- fonts: ${(args.style.fonts ?? []).join(', ') || '(none)'}`
    : ''
  // The safe-zone contract and shape primitive are specific to 9:16.
  const zoneBlock =
    args.ratio === '9:16'
      ? `\n${zoneGuideForPrompt(args.durationSeconds)}\n\n${shapeGuideForPrompt()}\n`
      : ''
  return `Build a single Hyperframes composition for scene ${args.sceneIndex + 1} of ${args.totalScenes}.

Aspect ratio: ${args.ratio}
Resolution: ${dims.width}x${dims.height}
Total duration (seconds): ${args.durationSeconds.toFixed(3)}
${style}
${zoneBlock}
Scene explainer (what the visuals should show and feel like). It MAY contain multiple SECTIONS / beats.
If it does, your timeline must traverse them sequentially in order, dividing the ${args.durationSeconds.toFixed(2)}-second duration between them, and NEVER looping:
"""
${args.explainer}
"""

The voiceover that will be played over this scene (for tone/pacing reference only — do not display this text on screen unless the explainer explicitly asks):
"""
${args.voiceover}
"""

Plan before you write code:

1. ENUMERATE every visible item across all steps. A "Step" in the explainer often groups
   multiple items. Walk each Step and break it into atomic items.
   For each item, write down one line in your internal plan:
     [item index]  [what it is]  [which Step it came from]
   Example for a 12-step explainer where Step 8 lists 3 bullets:
     1. yellow label
     2. yellow underline
     3. white context line A
     4. white context line B
     5. white separator
     6. left box outline
     7. left box header
     8. left box bullet 1   ← from Step 8
     9. left box bullet 2   ← from Step 8
     10. left box bullet 3  ← from Step 8
     ... and so on for every Step.
   Each item from this list becomes ONE DOM element with ONE animation.

2. ASSIGN A START TIME to every item from step 1, spread across [0, ${args.durationSeconds.toFixed(2)}].
   - Item 1 starts at or near t = 0.
   - Item N (the last) starts at NO EARLIER than t = ${(args.durationSeconds - 2.0).toFixed(2)} seconds
     (i.e. D − 2.0). This is a hard floor.
   - Distribute the rest roughly evenly. No gap between consecutive items longer than
     1.5 seconds during the first 90% of the timeline.
   - "One after another" items inside a step are staggered (e.g. 0.5–0.8s between each).

3. If the explainer has explicit time markers like "Step N (a–b s):" or "Beat N (a–b s):",
   those override your computed times for the matching step's start. Items WITHIN a step
   spread inside that step's window.

4. EACH ITEM'S INITIAL CSS STATE must be the pre-reveal state — opacity: 0, or
   stroke-dashoffset = path length, or off-screen transform. Otherwise the item
   shows at frame 0 and the "reveal" is a no-op.

5. CHOOSE a technique consistently across the whole composition:
   a) GSAP timeline with absolute time positions:
        const tl = gsap.timeline();
        tl.from('.el-1', { opacity: 0, y: 8, duration: 0.6 }, START_TIME);
      Prefer .from() so the element's CSS final state is the destination — less risk
      of forgetting the initial state.
   b) CSS @keyframes per element with \`animation-delay: <start>s\`,
      \`animation-iteration-count: 1\`, \`animation-fill-mode: both\`. \`both\` makes the
      element hold its 0% state before the delay AND its 100% state after the animation.

6. Final 0.5–1.5 seconds of the timeline is the settle hold. All items are visible.
   You MAY add ONE single-pass effect on the whole composition (slow zoom 1.00→1.02,
   slow pan, slow gradient drift) ending at exactly ${args.durationSeconds.toFixed(2)}s.
   One pass, not looping.

7. NEVER \`infinite\`, NEVER \`repeat: -1\`, NEVER \`repeatCount="indefinite"\`,
   NEVER \`setInterval\` for visible motion. Every \`@keyframes\` user MUST set
   \`animation-iteration-count: 1\` and \`animation-fill-mode\` explicitly.

8. If you find your enumerated items in step 1 are too few to fill ${args.durationSeconds.toFixed(2)} seconds
   without large gaps, ADD supporting items (a decorative arrow, a small doodle, an
   accent stroke) that fit the explainer's tone. Never pad by repeating earlier motion.

VERIFICATION before submitting:
- I have N distinct DOM elements, one per visible item.
- The LAST element's animation start time is ≥ ${(args.durationSeconds - 2.0).toFixed(2)}s.
- For EVERY animated element: start_time + duration ≤ ${(args.durationSeconds - 0.3).toFixed(2)}s
  (D − 0.3). If a write-in needs more than ${(args.durationSeconds - 0.3 - (args.durationSeconds - 2.0)).toFixed(1)}s for the latest
  element, the duration must be cut, not the start pushed earlier. The renderer hard-stops at
  ${args.durationSeconds.toFixed(2)}s; any animation still running at that instant is frozen
  half-finished and the viewer sees dim/faded text or a half-drawn box.
- No two consecutive items are more than 1.5s apart in start time.
- Every element's initial CSS is the pre-reveal state.
- Zero infinite/repeat animations anywhere.
- LAYOUT: the stage is a flex column with distinct top / body / bottom regions.
- LAYOUT: every "side by side" pair uses a flex row container, not absolute positioning.
- LAYOUT: every "below X" element is in flow after X (or in a later region), not
  absolutely positioned with a guessed top: value.
- LAYOUT: every box that contains multiple text pieces uses flex inside, with proper gap.
- LAYOUT: dividers / arrows / dashed lines have explicit dimensions and do not extend
  past the region they belong to.
- LAYOUT: at the final frame, NO two visible elements share screen space.
- LAYOUT: EVERY quoted text line sits on ONE visual line — white-space: nowrap, overflow-wrap:
  normal, word-break: keep-all. NO word is split across two lines. The font-size is small enough
  that the LONGEST line fits within the stage width minus side padding.
- LAYOUT: the composition FILLS the frame — the content block occupies roughly 60–85% of the
  safe-area height with comfortable (not huge) gaps. If the scene has few short lines, they are
  sized LARGE (headings ~90–120px, body ~58–76px), never small-and-scattered with dead zones.${
    args.ratio === '9:16'
      ? `
- SAFE ZONE (9:16): every element is a descendant of .safe; the required #stage > .safe scaffold
  is used verbatim; nothing touches or crosses the strict edge margins; the widest line fits the
  safe width. This is a hard gate — a cropped edge fails review.`
      : ''
  }
- COMPLETENESS: EVERY step in the explainer is built as its own element and reveals on the
  timeline. The final frame shows ALL of them, not just the heading. No element re-types or
  re-animates to fill time.
- ECONOMY: body/supporting lines animate as ONE write-in each (not per-letter). Per-letter
  is only for short headings. This keeps the document small enough to finish in one response.

Return ONLY the full HTML document, beginning with <!DOCTYPE html>.`
}

export interface SceneHtmlResult {
  html: string
  sanitized: string[]
  attempts: number
  validationStatus: 'passed' | 'failed-after-retries'
  validationLog: string[]
  /** 9:16 safe-zone outcome: 'ok' inside, 'force-fitted' geometrically corrected, 'skipped' not measured, 'n/a' non-9:16 */
  safeZone: 'ok' | 'force-fitted' | 'skipped' | 'n/a'
}

export interface AnimationTiming {
  start: number
  /**
   * Only set when we can extract the duration from the SAME construct as the
   * start. When missing, the validator treats the animation as instantaneous
   * for the end-time check (so we don't false-positive on isolated delays).
   */
  duration?: number
  source: string // brief tag used in error messages so the LLM knows what to fix
}

/**
 * Walk the generated HTML and find every animation's start time (and, when
 * detectable, its duration). Catches CSS shorthand and the delay/duration pair,
 * GSAP timeline positions + vars.duration, SVG <animate begin= dur=>, and Web
 * Animations / anime.js {delay, duration} objects.
 *
 * This replaces the older `extractMaxAnimationStartTime`. Kept under that name
 * as a thin wrapper for any callers that only care about start times.
 */
export function extractAnimationTimings(html: string): AnimationTiming[] {
  const out: AnimationTiming[] = []
  const push = (t: AnimationTiming): void => {
    if (!Number.isFinite(t.start) || t.start < 0 || t.start >= 600) return
    if (t.duration !== undefined && (!Number.isFinite(t.duration) || t.duration < 0 || t.duration >= 600)) {
      t.duration = undefined
    }
    out.push(t)
  }

  // CSS shorthand: `animation: name <dur>s <delay>s ...` — both timings captured.
  for (const m of html.matchAll(
    /animation\s*:\s*[A-Za-z_-][\w-]*\s+([\d.]+)(s|ms)\s+([\d.]+)(s|ms)/gi
  )) {
    const dur = m[2].toLowerCase() === 'ms' ? parseFloat(m[1]) / 1000 : parseFloat(m[1])
    const delay = m[4].toLowerCase() === 'ms' ? parseFloat(m[3]) / 1000 : parseFloat(m[3])
    push({ start: delay, duration: dur, source: 'css-animation-shorthand' })
  }

  // CSS animation-delay alone — we can't easily tie it to its sibling
  // animation-duration without parsing the whole style block, so we leave
  // duration undefined and let the start-time check do its work.
  for (const m of html.matchAll(/animation-delay\s*:\s*([-+]?[\d.]+)\s*(s|ms)\b/gi)) {
    const v = parseFloat(m[1])
    push({ start: m[2].toLowerCase() === 'ms' ? v / 1000 : v, source: 'css-animation-delay' })
  }

  // GSAP: .to(target, { ..., duration: X }, START) — START is the last positional arg.
  for (const m of html.matchAll(/\.\s*(?:to|from|fromTo|set|add)\s*\(([\s\S]*?)\)/g)) {
    const args = m[1]
    const trailing = args.match(/,\s*([\d.]+)\s*$/)
    if (!trailing) continue
    const start = parseFloat(trailing[1])
    const durMatch = args.match(/\bduration\s*:\s*([\d.]+)/)
    push({
      start,
      duration: durMatch ? parseFloat(durMatch[1]) : undefined,
      source: 'gsap'
    })
  }

  // SVG <animate begin="X" dur="Y">. Attribute order can vary so scan attrs.
  for (const m of html.matchAll(/<animate(?:Motion|Transform)?\b([^>]*)>/gi)) {
    const attrs = m[1]
    const beginM = attrs.match(/\bbegin\s*=\s*["']\s*([\d.]+)\s*(s|ms)?\s*["']/i)
    if (!beginM) continue
    const beginUnit = (beginM[2] ?? 's').toLowerCase()
    const start = beginUnit === 'ms' ? parseFloat(beginM[1]) / 1000 : parseFloat(beginM[1])
    const durM = attrs.match(/\bdur\s*=\s*["']\s*([\d.]+)\s*(s|ms)?\s*["']/i)
    let duration: number | undefined
    if (durM) {
      const durUnit = (durM[2] ?? 's').toLowerCase()
      duration = durUnit === 'ms' ? parseFloat(durM[1]) / 1000 : parseFloat(durM[1])
    }
    push({ start, duration, source: 'svg-animate' })
  }

  // Web Animations / anime.js: { delay: D, duration: T } in the same braces.
  // Brace-content scan is cheap and good enough for the typical patterns.
  for (const m of html.matchAll(/\{([^{}]*)\}/g)) {
    const block = m[1]
    const delayM = block.match(/\bdelay\s*:\s*([\d.]+)/)
    if (!delayM) continue
    const delayRaw = parseFloat(delayM[1])
    // Heuristic: > 30 is almost certainly milliseconds (a 30-second pure delay is implausible).
    const start = delayRaw > 30 ? delayRaw / 1000 : delayRaw
    const durM = block.match(/\bduration\s*:\s*([\d.]+)/)
    let duration: number | undefined
    if (durM) {
      const durRaw = parseFloat(durM[1])
      duration = durRaw > 30 ? durRaw / 1000 : durRaw
    }
    push({ start, duration, source: 'webanim-or-anime.js' })
  }

  return out
}

/**
 * Backwards-compatible wrapper. Returns just the max start time across all
 * detected animations — the older API surface.
 */
export function extractMaxAnimationStartTime(html: string): {
  maxStartSeconds: number
  found: number
  starts: number[]
} {
  const timings = extractAnimationTimings(html)
  const starts = timings.map((t) => t.start)
  const maxStartSeconds = starts.length > 0 ? Math.max(...starts) : 0
  return { maxStartSeconds, found: starts.length, starts }
}

export interface ValidationResult {
  ok: boolean
  maxStartSeconds: number
  maxEndSeconds: number
  found: number
  reason?: string
}

/**
 * Two coverage rules, both enforced on every retry:
 *
 *   A) The LAST animation must START no earlier than D − 2.0s — otherwise the
 *      timeline is compressed into the front of the scene and the tail looks
 *      frozen or loops.
 *
 *   B) EVERY animation must END (start + duration) no later than D − 0.3s —
 *      otherwise Hyperframes hard-stops mid-animation at t = D and the viewer
 *      sees dim/faded text or a half-drawn box (the exact "Mann-Whitney box"
 *      defect that motivated this rule). We can only enforce this on
 *      animations where the duration is in the same construct as the start
 *      (CSS shorthand, GSAP vars, SVG dur=, anime.js); for isolated
 *      animation-delay lines we have no duration to check and fall back to A.
 */
export function validateAnimationCoverage(
  html: string,
  durationSeconds: number
): ValidationResult {
  const timings = extractAnimationTimings(html)
  const found = timings.length
  const starts = timings.map((t) => t.start)
  const ends = timings.map((t) => t.start + (t.duration ?? 0))
  const maxStartSeconds = starts.length > 0 ? Math.max(...starts) : 0
  const maxEndSeconds = ends.length > 0 ? Math.max(...ends) : 0

  if (found === 0) {
    return {
      ok: false,
      maxStartSeconds: 0,
      maxEndSeconds: 0,
      found: 0,
      reason:
        'No animation start times detected anywhere in the HTML (no CSS animation-delay, no GSAP positional args, no SVG begin=, no delay: properties). The composition has no scheduled timeline — every element would appear at frame 0.'
    }
  }

  // Rule A — the reveals should span a reasonable portion of the scene so the
  // timeline isn't crammed into the first second (which would read as
  // "everything appeared at once"). We deliberately DON'T demand the last
  // animation run until D−2.0 anymore: a calm static hold at the end is fine
  // and healthy, and the old strict rule was pushing the model to invent
  // time-filling ambient motion that turned into flicker/loops. A short static
  // tail is now allowed; the deterministic motion audit (on the rendered video)
  // is what distinguishes a fine hold from a real loop.
  const minStartRequired = Math.max(0.5, durationSeconds * 0.4)
  const maxEndAllowed = durationSeconds - 0.3

  if (maxStartSeconds < minStartRequired) {
    return {
      ok: false,
      maxStartSeconds,
      maxEndSeconds,
      found,
      reason:
        `The latest animation in the HTML starts at t=${maxStartSeconds.toFixed(2)}s, ` +
        `but for a ${durationSeconds.toFixed(2)}s scene the reveals must span at least the first ` +
        `${minStartRequired.toFixed(2)}s (40% of the scene). Right now the timeline is compressed into ` +
        `the first ${(maxStartSeconds + 1).toFixed(1)}s. Spread the element reveals out — but a calm ` +
        `static hold AFTER the last reveal is fine; do NOT add looping/pulsing motion to fill time.`
    }
  }

  // Rule B — every animation finishes inside the timeline.
  const overflow = timings.filter(
    (t) => t.duration !== undefined && t.start + t.duration > maxEndAllowed + 0.001
  )
  if (overflow.length > 0) {
    // Sort worst-first so the message names the most egregious one.
    overflow.sort((a, b) => b.start + (b.duration ?? 0) - (a.start + (a.duration ?? 0)))
    const worst = overflow[0]
    const worstEnd = worst.start + (worst.duration ?? 0)
    const summary = overflow
      .slice(0, 4)
      .map(
        (t) =>
          `    • ${t.source}: starts at ${t.start.toFixed(2)}s, duration ${t.duration!.toFixed(2)}s → ends at ${(t.start + (t.duration ?? 0)).toFixed(2)}s`
      )
      .join('\n')
    return {
      ok: false,
      maxStartSeconds,
      maxEndSeconds,
      found,
      reason:
        `${overflow.length} animation(s) end AFTER the t=${maxEndAllowed.toFixed(2)}s deadline (D − 0.3s). ` +
        `The renderer hard-stops at D=${durationSeconds.toFixed(2)}s, so these animations get cut off mid-progress — ` +
        `text appears dim/faded, boxes are missing edges, write-ins show only the first few letters. Worst offender ends at ` +
        `t=${worstEnd.toFixed(2)}s (${(worstEnd - durationSeconds).toFixed(2)}s past D). Offenders:\n${summary}\n` +
        `Fix: SHORTEN each offending animation's duration so start + duration ≤ ${maxEndAllowed.toFixed(2)}s. ` +
        `Do NOT push start times earlier — that would re-break rule A (timeline compression).`
    }
  }

  return { ok: true, maxStartSeconds, maxEndSeconds, found }
}

const MAX_ATTEMPTS = 3

export async function generateSceneHtml(args: SceneRenderArgs): Promise<SceneHtmlResult> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })

  const log: string[] = []
  let lastSanitized: string[] = []
  let lastHtml = ''
  let lastReason = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const userPrompt = buildUserPromptForAttempt(args, attempt, lastReason)

    // We MUST stream here. With max_tokens this high, a single non-streaming
    // call could exceed the SDK's 10-minute request guard, which makes the SDK
    // refuse the request outright ("Streaming is strongly recommended…"). Using
    // the streaming API and awaiting the final assembled message both satisfies
    // that guard and avoids socket idle-timeouts on long dense-scene generations.
    const stream = client.messages.stream({
      model: args.model || 'claude-opus-4-8',
      // Dense scenes (6+ steps, letter-by-letter spans) generate a LOT of HTML.
      // 16k was truncating the densest scenes mid-document, leaving only the
      // first element built and the rest never revealed. 32k gives ample room.
      max_tokens: 32000,
      system: args.mode === 'intro' || args.mode === 'outro' ? INTRO_OUTRO_SYSTEM : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })
    const resp = await stream.finalMessage()

    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()

    // If the model hit the output cap, the HTML is almost certainly truncated
    // (cut off mid-document → only the first elements built, the classic
    // "only step 1 renders and loops" failure). Treat it as a retryable
    // validation failure instead of a hard throw, and tell the next attempt
    // to be more economical.
    if (resp.stop_reason === 'max_tokens') {
      lastReason =
        'The HTML was cut off because it exceeded the output token budget. The composition ' +
        'was incomplete — later steps were never written, so only the first element(s) render. ' +
        'Be more economical: animate body lines as ONE write-in per line (not per-letter), reserve ' +
        'letter-by-letter for short headings only, and avoid needless wrapper markup.'
      log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: FAILED — output truncated at token cap`)
      continue
    }

    let cleanHtml: string
    let sanitized: string[]
    try {
      const html = extractHtml(text)
      const cleaned = sanitizeLoops(html)
      cleanHtml = cleaned.html
      sanitized = cleaned.sanitized
      // Guarantee the correct shape primitive is present (9:16 only). Injected
      // before measurement so overlap detection sees the real box geometry, and
      // before render so the exported video uses the guaranteed-closed borders.
      if (args.ratio === '9:16') cleanHtml = injectShapeAssets(cleanHtml)
    } catch (err: any) {
      // Incomplete / malformed document — retry rather than aborting the job.
      lastReason =
        `The response was not a complete HTML document (${err?.message ?? err}). ` +
        `Return ONE complete document from <!DOCTYPE html> to </html> with all steps built.`
      log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: FAILED — ${lastReason}`)
      continue
    }

    // -------- Deterministic TEXT-COVERAGE validation (scenes only) --------
    // Every display line of the explainer must exist in the HTML. A missing
    // line was never authored — it can't be fixed by animation repairs, so
    // catch it BEFORE any render is spent.
    if (args.mode !== 'intro' && args.mode !== 'outro') {
      const missing = missingDisplayLines(args.explainer, cleanHtml)
      if (missing.length > 0 && attempt < MAX_ATTEMPTS) {
        lastReason =
          `These required on-screen lines are MISSING from the HTML entirely: ` +
          missing.map((l) => `"${l}"`).join(', ') +
          `. Build EVERY quoted display line from the explainer — none may be omitted, ` +
          `each in its own band with its own reveal.`
        lastSanitized = sanitized
        lastHtml = cleanHtml
        log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: FAILED text-coverage (${missing.length} display line(s) missing) — regenerating with exact feedback`)
        continue
      } else if (missing.length > 0) {
        log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: WARNING — ${missing.length} display line(s) still missing after ${MAX_ATTEMPTS} attempts; shipping best effort`)
      }
    }

    const validation = validateAnimationCoverage(cleanHtml, args.durationSeconds)

    lastSanitized = sanitized
    lastHtml = cleanHtml

    if (validation.ok) {
      log.push(
        `attempt ${attempt}/${MAX_ATTEMPTS}: animation-coverage passed (last start t=${validation.maxStartSeconds.toFixed(2)}s, latest end t=${validation.maxEndSeconds.toFixed(2)}s, ${validation.found} timed reveals)`
      )

      // -------- Deterministic 9:16 safe-zone enforcement --------
      // Measure the real geometry of the rendered HTML. On overflow: retry with
      // exact pixel feedback (Claude usually fixes it at full size); on the LAST
      // attempt, apply a guaranteed geometric force-fit so the export is never
      // cropped. Non-9:16 scenes skip this entirely.
      if (args.ratio === '9:16') {
        const isFinalAttempt = attempt === MAX_ATTEMPTS
        const measurement = await measureSafeZone(cleanHtml, args.durationSeconds)

        if (!measurement.measured) {
          log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: safe-zone measurement skipped (${measurement.note ?? 'unavailable'})`)
          return finalize(cleanHtml, sanitized, attempt, 'passed', 'skipped', log)
        }

        const edgeOverflow = !measurement.ok
        const overlaps = measurement.overlaps
        const empties = measurement.emptyShapes

        const safeH = SAFE_AREA.bottom - SAFE_AREA.top
        const contentH = measurement.content ? measurement.content.maxY - measurement.content.minY : safeH
        const fillFrac = contentH / safeH
        const sparse = fillFrac < MIN_VERTICAL_FILL

        if (!edgeOverflow && overlaps.length === 0 && empties.length === 0 && !sparse) {
          const c = measurement.content!
          log.push(
            `attempt ${attempt}/${MAX_ATTEMPTS}: safe-zone OK (content x[${Math.round(c.minX)},${Math.round(c.maxX)}] y[${Math.round(c.minY)},${Math.round(c.maxY)}], fills ${Math.round(fillFrac * 100)}% of safe height, no shape overlaps, no empty shapes)`
          )
          return finalize(cleanHtml, sanitized, attempt, 'passed', 'ok', log)
        }

        // A violation exists (edge overflow, text-over-shape overlap, or empty box).
        if (!isFinalAttempt) {
          const reasons: string[] = []
          if (edgeOverflow) reasons.push(safeZoneFeedback(measurement))
          if (overlaps.length > 0) reasons.push(overlapFeedback(overlaps))
          if (empties.length > 0) reasons.push(emptyShapeFeedback(empties))
          if (sparse && !edgeOverflow)
            reasons.push(
              `LAYOUT TOO SPARSE: the content block spans only ${Math.round(contentH)}px of the ${Math.round(safeH)}px-tall safe area (${Math.round(fillFrac * 100)}% — it must fill at least ${Math.round(MIN_VERTICAL_FILL * 100)}%, aim for ~75%). The frame reads as mostly empty bands above and below a small centered cluster. Keep the SAME text content but SCALE THE COMPOSITION UP: increase every font-size and the vertical gaps between blocks until the first element sits near the top of the safe area and the last near its bottom. Do NOT add new content, do NOT break words across lines, do NOT exceed the safe area.`
            )
          lastReason = reasons.join('\n\n')
          lastHtml = cleanHtml
          const bits: string[] = []
          if (edgeOverflow) {
            bits.push(
              'edge ' +
                Object.entries(measurement.overflow)
                  .filter(([, v]) => v > 1)
                  .map(([k, v]) => `${k}+${Math.round(v)}px`)
                  .join('/')
            )
          }
          if (overlaps.length > 0) bits.push(`${overlaps.length} text-on-outline overlap(s)`)
          if (empties.length > 0) bits.push(`${empties.length} empty shape(s)`)
          if (sparse && !edgeOverflow) bits.push(`sparse layout (${Math.round(fillFrac * 100)}% of safe height)`)
          log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: FAILED safe-zone (${bits.join(', ')}) — regenerating with exact feedback`)
          continue
        }

        // Final attempt. Edge overflow is force-fittable (geometric). Overlaps
        // are not (scaling preserves relative overlap) — the structural .hf-box
        // primitive is the prevention; if any remain we log and ship best output.
        let outHtml = cleanHtml
        let sz: SceneHtmlResult['safeZone'] = 'ok'
        if (edgeOverflow) {
          const fit = fitHtmlToSafeZone(cleanHtml, measurement)
          outHtml = fit.fitted ? fit.html : cleanHtml
          sz = 'force-fitted'
          log.push(
            `attempt ${attempt}/${MAX_ATTEMPTS}: safe-zone edge still violated — applied geometric force-fit (scale ${fit.scale.toFixed(3)}) so nothing is cropped`
          )
        }
        if (overlaps.length > 0) {
          log.push(
            `attempt ${attempt}/${MAX_ATTEMPTS}: WARNING — ${overlaps.length} text-on-shape overlap(s) remain after ${MAX_ATTEMPTS} attempts: ` +
              overlaps.map((o) => `"${o.text}" (${o.side})`).join(', ')
          )
        }
        if (empties.length > 0) {
          log.push(
            `attempt ${attempt}/${MAX_ATTEMPTS}: WARNING — ${empties.length} empty shape(s) remain after ${MAX_ATTEMPTS} attempts (a box rendered with no text inside). Consider using plain text instead of a box for this scene.`
          )
        }
        if (sparse) {
          log.push(
            `attempt ${attempt}/${MAX_ATTEMPTS}: WARNING — layout still sparse after ${MAX_ATTEMPTS} attempts (content fills ${Math.round(fillFrac * 100)}% of the safe height; target ≥${Math.round(MIN_VERTICAL_FILL * 100)}%) — shipping best output`
          )
        }
        return finalize(outHtml, sanitized, attempt, 'passed', sz, log)
      }

      return finalize(cleanHtml, sanitized, attempt, 'passed', 'n/a', log)
    }

    lastReason = validation.reason ?? 'unknown failure'
    log.push(`attempt ${attempt}/${MAX_ATTEMPTS}: FAILED — ${lastReason}`)
  }

  // Every attempt failed before producing a usable document (all truncated or
  // malformed). Fail loudly rather than handing an empty string to the renderer.
  if (!lastHtml) {
    throw new Error(
      `Claude failed to produce a complete HTML document for this scene after ${MAX_ATTEMPTS} attempts. ` +
        `Last reason: ${lastReason || 'unknown'}. This scene may have too much content for one composition — ` +
        `consider splitting it into two scenes.`
    )
  }

  // Ran out of attempts on a non-safe-zone failure. For 9:16, still guarantee the
  // export is inside the safe area by force-fitting the best HTML we have.
  let outHtml = lastHtml
  let safeZone: SceneHtmlResult['safeZone'] = 'n/a'
  if (args.ratio === '9:16') {
    const measurement = await measureSafeZone(lastHtml, args.durationSeconds)
    if (measurement.measured && !measurement.ok) {
      const fit = fitHtmlToSafeZone(lastHtml, measurement)
      outHtml = fit.fitted ? fit.html : lastHtml
      safeZone = 'force-fitted'
      log.push(`final: applied geometric safe-zone force-fit (scale ${fit.scale.toFixed(3)})`)
    } else {
      safeZone = measurement.measured ? 'ok' : 'skipped'
    }
  }

  return {
    html: outHtml,
    sanitized: lastSanitized,
    attempts: MAX_ATTEMPTS,
    validationStatus: 'failed-after-retries',
    validationLog: log,
    safeZone
  }
}

function finalize(
  html: string,
  sanitized: string[],
  attempts: number,
  validationStatus: SceneHtmlResult['validationStatus'],
  safeZone: SceneHtmlResult['safeZone'],
  validationLog: string[]
): SceneHtmlResult {
  return { html, sanitized, attempts, validationStatus, validationLog, safeZone }
}

// ====================================================================
// SURGICAL REPAIR — fix ONLY the reviewer's issues with the smallest set
// of find/replace edits, preserving the rest of the working HTML byte-for-
// byte. This avoids the "rewrite the whole scene to fix one word and
// regress everything else" failure mode, and costs a fraction of a full
// regeneration (small output, no re-derivation of the whole composition).
// ====================================================================

export interface RepairArgs {
  apiKey: string
  model: string
  html: string
  issues: string[]
  explainer: string
  ratio: AspectRatio
  durationSeconds: number
}

export interface RepairResult {
  html: string
  applied: number
  failed: string[]
  safeZone: SceneHtmlResult['safeZone']
  log: string[]
}

const REPAIR_SYSTEM = `You are a precise HTML repair tool for animated motion-graphics scenes.

You are given a COMPLETE, WORKING HTML document and a list of SPECIFIC visual issues found
in its rendered final frame. Fix ONLY those issues with the SMALLEST possible set of edits.

ABSOLUTE RULES:
- Do NOT rewrite, restructure, or reformat the document. Do NOT touch anything unrelated to
  the listed issues. Every part of the HTML you don't explicitly edit must stay identical.
- Make the SMALLEST change that resolves each issue. Prefer, in order: adjust a font-size,
  adjust a color, adjust spacing/padding, adjust a position value, close/complete a tag.
  A cropped or oversized line is almost always fixed by REDUCING its font-size — do that
  rather than moving or restructuring anything.
- Do NOT introduce new problems. Never move an element to fix a different element unless the
  issue explicitly requires it. Changing a size or color is always safer than moving things.
- For 9:16 scenes: keep every element inside the .safe container; for boxes/circles with text,
  keep using the .hf-box / .hf-circle primitive with text as children — never switch a box to
  an SVG stroke and never place text over a separately-drawn shape.

OUTPUT FORMAT — respond with ONLY this JSON, no prose, no code fences:
{ "edits": [ { "find": "<verbatim substring from the HTML>", "replace": "<replacement>", "reason": "<which issue this fixes>" } ] }

Rules for each edit:
- "find" MUST be copied VERBATIM from the given HTML — exact characters, spacing, and quotes —
  and MUST be unique (appear exactly once). Include a little surrounding context to make it
  unique if the raw value repeats.
- Keep "find" short and targeted (a single attribute, style declaration, or tag), not whole blocks.
- Only include edits that fix a listed issue. If an issue cannot be fixed with a small edit,
  include your best minimal edit for it anyway — do NOT rewrite the document.`

interface Edit {
  find: string
  replace: string
  reason?: string
}

export async function repairSceneHtml(args: RepairArgs): Promise<RepairResult> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })
  const log: string[] = []

  const userPrompt =
    `Ratio: ${args.ratio}\n` +
    `Scene explainer (context only — do not restructure to match it, just fix the issues):\n"""\n${args.explainer}\n"""\n\n` +
    `Issues found in the rendered FINAL frame — fix ONLY these, with minimal edits:\n` +
    args.issues.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
    `\n\nCURRENT complete HTML (copy each "find" verbatim from this):\n\n` +
    '```html\n' +
    args.html +
    '\n```'

  const stream = client.messages.stream({
    model: args.model || 'claude-opus-4-8',
    max_tokens: 8000,
    system: REPAIR_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }]
  })
  const resp = await stream.finalMessage()
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
    .trim()

  const edits = parseEdits(text)
  if (edits.length === 0) {
    log.push('repair: model returned no usable edits')
    return {
      html: args.html,
      applied: 0,
      failed: ['no edits parsed'],
      safeZone: args.ratio === '9:16' ? 'skipped' : 'n/a',
      log
    }
  }

  const { html: patched, applied, failed } = applyEdits(args.html, edits)
  log.push(
    `repair: applied ${applied}/${edits.length} minimal edit(s)${failed.length ? `, ${failed.length} could not apply` : ''}`
  )
  for (const f of failed) log.push(`  - skipped: ${f}`)

  // Re-assert the deterministic guarantees on the patched HTML: a repair may
  // itself introduce a loop or an ends-invisible keyframe — sanitize again.
  let outHtml = patched
  if (applied > 0) {
    const resan = sanitizeLoops(outHtml)
    outHtml = resan.html
    for (const n of resan.sanitized) log.push(`repair sanitize: ${n}`)
  }
  let safeZone: RepairResult['safeZone'] = 'n/a'
  if (args.ratio === '9:16') {
    if (applied > 0) {
      outHtml = injectShapeAssets(outHtml)
      const m = await measureSafeZone(outHtml, args.durationSeconds)
      if (m.measured && !m.ok) {
        const fit = fitHtmlToSafeZone(outHtml, m)
        outHtml = fit.fitted ? fit.html : outHtml
        safeZone = 'force-fitted'
        log.push(`repair: patched content exceeded the safe zone — applied geometric force-fit (scale ${fit.scale.toFixed(3)})`)
      } else {
        safeZone = m.measured ? 'ok' : 'skipped'
      }
    } else {
      safeZone = 'skipped'
    }
  }

  return { html: outHtml, applied, failed, safeZone, log }
}

function parseEdits(text: string): Edit[] {
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/, '').trim()
  }
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1)
  try {
    const parsed = JSON.parse(raw)
    const arr = Array.isArray(parsed.edits) ? parsed.edits : []
    return arr
      .filter((e: any) => e && typeof e.find === 'string' && typeof e.replace === 'string' && e.find.length > 0)
      .map((e: any) => ({
        find: e.find as string,
        replace: e.replace as string,
        reason: typeof e.reason === 'string' ? e.reason : undefined
      }))
  } catch {
    return []
  }
}

/**
 * Apply edits as exact, unique string replacements. An edit that doesn't match
 * verbatim, or matches more than once, is skipped (reported in `failed`) rather
 * than risking a wrong or duplicated change. Edits apply sequentially against
 * the evolving document.
 */
function applyEdits(html: string, edits: Edit[]): { html: string; applied: number; failed: string[] } {
  let out = html
  let applied = 0
  const failed: string[] = []
  for (const e of edits) {
    if (e.find === e.replace) {
      failed.push(`no-op: ${shortEdit(e)}`)
      continue
    }
    const idx = out.indexOf(e.find)
    if (idx < 0) {
      failed.push(`not found verbatim: ${shortEdit(e)}`)
      continue
    }
    if (out.indexOf(e.find, idx + e.find.length) >= 0) {
      failed.push(`ambiguous (matches >1): ${shortEdit(e)}`)
      continue
    }
    out = out.slice(0, idx) + e.replace + out.slice(idx + e.find.length)
    applied++
  }
  return { html: out, applied, failed }
}

function shortEdit(e: Edit): string {
  return (e.reason || e.find).replace(/\s+/g, ' ').slice(0, 60)
}

// ====================================================================
// TEMPLATE ADAPTATION — reuse a proven composition by swapping ONLY its
// text to match a new scene. The template's layout, animation, structure,
// classes and sizing are known-good (it passed review on the first try),
// so we change as little as possible: the visible text and per-line
// colors the new script calls for.
// ====================================================================

const ADAPT_SYSTEM = `You are adapting a PROVEN, working HTML motion-graphics template to present a NEW scene's text.

The template already renders correctly — its layout, animation timing, structure, CSS classes and
font sizes are known-good. Your ONLY job is to change the visible TEXT (and per-line colors the new
script explicitly calls for) so the composition presents the NEW scene's content instead of the old.

ABSOLUTE RULES:
- Preserve ALL structure, classes, positioning, sizing and the animation STYLE. Change text content
  and colors only. Do NOT convert boxes to SVG strokes and do NOT restructure.
- DURATION: the user message states the template's ORIGINAL duration and the NEW scene's duration.
  If they differ, you MUST also retime: edit the #stage data-duration attribute to the NEW duration,
  and edit any animation delay/start/duration values that would still be running past
  (NEW duration − 0.3s) so EVERY animation finishes by then. Keep the same reveal ORDER and pacing
  feel; a calm static hold after the last reveal is fine when the new scene is longer. Never leave
  an animation mid-flight at the end — it freezes half-drawn/faded.
- Map the new scene's lines onto the template's existing line elements in order (heading → heading,
  body line → body line, box line → box line).
- If the new scene has ONE more or ONE fewer line than the template, add/remove a single line element
  by copying the exact pattern of an existing sibling (same classes/attributes) — nothing more.
- Keep every line on ONE visual line; if a new line is longer than the old, REDUCE that line's
  font-size so it still fits. Never let text overflow.

OUTPUT FORMAT — respond with ONLY this JSON, no prose, no code fences:
{ "edits": [ { "find": "<verbatim substring from the template HTML>", "replace": "<replacement>", "reason": "<what this swaps>" } ] }

Rules for each edit (identical to a precise find/replace):
- "find" MUST be copied VERBATIM from the template HTML and be unique (appears exactly once); add a
  little surrounding context if a raw value repeats.
- Keep each "find" targeted (one text node / attribute), not whole blocks.`

/**
 * Adapt a proven template's text to a new scene. Same deterministic edit-apply
 * path as repairSceneHtml, so unchanged structure stays byte-for-byte identical.
 */
export async function adaptTemplateHtml(args: {
  apiKey: string
  model: string
  templateHtml: string
  explainer: string
  ratio: AspectRatio
  durationSeconds: number
}): Promise<RepairResult> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })
  const log: string[] = []

  const oldDurMatch = /data-duration\s*=\s*["']([\d.]+)["']/.exec(args.templateHtml)
  const oldDur = oldDurMatch ? parseFloat(oldDurMatch[1]) : null
  const newDur = args.durationSeconds

  const userPrompt =
    `Ratio: ${args.ratio}\n` +
    `DURATION: the template was authored for ${oldDur !== null ? oldDur.toFixed(2) : 'an unknown'}s; ` +
    `the NEW scene runs ${newDur.toFixed(2)}s. Include edits that set data-duration to ${newDur.toFixed(3)} ` +
    `and retime any animation delay/start/duration values so every animation FINISHES by ${(newDur - 0.3).toFixed(2)}s.\n\n` +
    `NEW scene explainer — make the template present THIS content:\n"""\n${args.explainer}\n"""\n\n` +
    `PROVEN template HTML (copy each "find" verbatim from this; change only text/colors/timing):\n\n` +
    '```html\n' +
    args.templateHtml +
    '\n```'

  const stream = client.messages.stream({
    model: args.model || 'claude-opus-4-8',
    max_tokens: 8000,
    system: ADAPT_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }]
  })
  const resp = await stream.finalMessage()
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
    .trim()

  const edits = parseEdits(text)
  if (edits.length === 0) {
    log.push('template-adapt: model returned no usable edits')
    return {
      html: args.templateHtml,
      applied: 0,
      failed: ['no edits parsed'],
      safeZone: args.ratio === '9:16' ? 'skipped' : 'n/a',
      log
    }
  }

  const { html: patched, applied, failed } = applyEdits(args.templateHtml, edits)
  log.push(
    `template-adapt: applied ${applied}/${edits.length} text edit(s)${failed.length ? `, ${failed.length} could not apply` : ''}`
  )
  for (const f of failed) log.push(`  - skipped: ${f}`)

  let outHtml = patched
  if (applied > 0) {
    // Deterministic guarantee: the adapted card renders at the NEW duration even
    // if the model forgot to edit data-duration. Then verify the retimed
    // animations still fit the new timeline and surface any mismatch in the log
    // (the render/review loop + fallbacks handle it downstream).
    outHtml = patchStageDuration(outHtml, newDur)
    log.push(`template-adapt: data-duration set to ${newDur.toFixed(3)}s (template was ${oldDur !== null ? oldDur.toFixed(2) + 's' : 'unknown'})`)
    const cov = validateAnimationCoverage(outHtml, newDur)
    if (cov.ok) {
      log.push(`template-adapt: animation coverage OK for the new duration (last start ${cov.maxStartSeconds.toFixed(2)}s, latest end ${cov.maxEndSeconds.toFixed(2)}s)`)
    } else {
      log.push(`template-adapt: WARNING — retimed template may not fit the new duration: ${cov.reason ?? 'unknown'}`)
    }
  }
  let safeZone: RepairResult['safeZone'] = 'n/a'
  if (args.ratio === '9:16') {
    if (applied > 0) {
      outHtml = injectShapeAssets(outHtml)
      const m = await measureSafeZone(outHtml, args.durationSeconds)
      if (m.measured && !m.ok) {
        const fit = fitHtmlToSafeZone(outHtml, m)
        outHtml = fit.fitted ? fit.html : outHtml
        safeZone = 'force-fitted'
        log.push(`template-adapt: content exceeded the safe zone — applied geometric force-fit (scale ${fit.scale.toFixed(3)})`)
      } else {
        safeZone = m.measured ? 'ok' : 'skipped'
      }
    } else {
      safeZone = 'skipped'
    }
  }

  return { html: outHtml, applied, failed, safeZone, log }
}

function buildUserPromptForAttempt(
  args: SceneRenderArgs,
  attempt: number,
  prevReason: string
): string {
  let basePrompt = buildUserPrompt(args)

  // Prepend any visual-review feedback from a prior render of this scene.
  if (args.visualFeedback && args.visualFeedback.length > 0) {
    basePrompt =
      `IMPORTANT — A previous render of this exact scene was visually reviewed and FAILED.\n` +
      `The reviewer found these specific issues (you MUST fix every one):\n` +
      args.visualFeedback.map((issue) => `  • ${issue}`).join('\n') +
      `\n\nProduce HTML that addresses all of the above. Pay extra attention to:\n` +
      `  - Shape integrity (complete boxes, closed paths, full stroke draws).\n` +
      `  - No overlapping elements at the final frame.\n` +
      `  - All items from the explainer must appear and be visible / readable.\n\n` +
      `---\n\n` +
      basePrompt
  }

  if (attempt === 1) return basePrompt

  // The retry reason may be about animation coverage, truncation, the safe-zone
  // measurement, OR text-over-shape overlap. Lead with the exact reason (it
  // already contains the specifics and precise pixel numbers), then add the
  // relevant reminders.
  const isLayout = /SAFE ZONE|OVERLAPS A SHAPE|EMPTY SHAPE/i.test(prevReason)
  const minRequired = Math.max(0.5, args.durationSeconds - 2.0)
  const reminders = isLayout
    ? `You MUST fix this in this attempt:\n` +
      `  - Move/shrink the named elements so EVERY element is fully inside the safe area\n` +
      `    x[60, 1020] y[160, 1680]. Reduce font-size before anything else.\n` +
      `  - For any box/circle containing text, use the provided .hf-box / .hf-circle primitive\n` +
      `    with the text as child elements — never text positioned over a separately-drawn shape.\n` +
      `  - Keep all content inside the required #stage > .safe scaffold; nothing may extend past it.\n` +
      `  - Do not let any single line get wider than 960px — shrink the font until it fits.\n`
    : `You MUST fix this in this attempt:\n` +
      `  - The LAST visible animation start time MUST be ≥ ${minRequired.toFixed(2)}s\n` +
      `    (we measure this by scanning the HTML for CSS animation-delay,\n` +
      `     GSAP positional args, SVG begin=, and delay: properties).\n` +
      `  - Spread your animations across the full ${args.durationSeconds.toFixed(2)}s duration.\n` +
      `  - Every visible item from the explainer is its own DOM element with its own staggered start time.\n` +
      `  - Do NOT cluster all reveals into the first few seconds.\n`
  return (
    basePrompt +
    `\n\n---\n` +
    `RETRY — your previous attempt failed automated validation:\n\n` +
    `  ${prevReason}\n\n` +
    reminders +
    `Return ONLY the corrected complete HTML document.`
  )
}

// ====================================================================
// VISUAL REVIEW — uses Claude's vision capability to inspect the rendered
// frame and decide whether it faithfully implements the explainer.
// ====================================================================

const REVIEWER_SYSTEM = `You are a strict quality reviewer for AI-generated animated video scenes.

Your input:
  1. An explainer that describes what a scene should show.
  2. A screenshot of the LAST FRAME of that scene — i.e. the moment just before the video
     ends. Every animated element should be in its FINAL, fully-settled state by now.

Your job: determine whether the rendered frame faithfully implements the explainer.
Be strict — false positives (passing a broken scene) are MUCH worse than false negatives
(failing a slightly-imperfect scene). When a defect is plausible but you're not certain,
FAIL the scene and let the system regenerate.

Check, in this order:

A. ANIMATION COMPLETION — because this is the LAST frame, every element must be fully drawn
   and fully opaque (unless the explainer explicitly requests a transparency / fade effect).
   This is the most common defect — look for it FIRST:
   - Text that appears DIM, FADED, GREY (when the explainer specifies white/yellow/blue/etc),
     SEMI-TRANSPARENT, or otherwise less-bright than its neighbours. This means a write-in
     animation was cut off — the text is frozen at e.g. 40% opacity. FAIL.
   - Text where only the first part of the word/sentence is visible (write-on animation
     cut off mid-letter). FAIL.
   - A box, rectangle, or shape outline where the stroke didn't finish — a missing side,
     a visible gap on one edge, a dashed line that stops short. FAIL.
   - Two visually identical elements where ONE is bright and the OTHER is dim — the dim
     one is almost certainly an animation-completion failure even if you can read both. FAIL.
   When in doubt about whether something looks "intentionally subtle" vs "cut off mid-anim",
   FAIL — the regeneration is cheap, a broken final video is not.

B. COMPLETENESS — every item described in the explainer should be visible in the image.
   List any item from the explainer that is missing, cut off, or unreadable.
   - SPECIAL CASE — "only the first element rendered": if the explainer lists several steps/lines
     but the frame shows ONLY the heading (or only the first line) with the rest of the frame
     empty, FAIL and say so explicitly. This is a broken render where later steps never appeared.
     Name each missing step. A scene with a large empty lower region and only the top line present
     is ALWAYS a failure.

C. SHAPE INTEGRITY — every drawn shape must be complete:
   - Rectangles / boxes: all 4 sides connected end-to-end. Flag any "3-sided box".
   - Triangles: all 3 sides connected.
   - Circles / ellipses: fully closed.
   - Lines and arrows: drawn from one endpoint to the other, with arrowhead present.
   - Dashed lines: visible across their intended length, not stopping short.

D. OVERLAPS — no element may visually overlap another element's content. Flag:
   - Text overlapping other text.
   - Text crossing through a divider, arrow, or box edge.
   - Boxes overlapping each other.
   - Text outside its container.

E. LAYOUT BALANCE — content is reasonably balanced and FILLS the frame. Flag:
   - Text cut off at the screen edges.
   - Huge empty regions that should contain content.
   - Cramped, illegible clusters.
   - SPARSE LAYOUT: the content is small and scattered with large dead gaps between
     items (e.g. a few short lines spread far apart with most of the frame empty).
     Flag it with a concrete fix: "increase the font sizes and tighten the vertical
     gaps so the block fills the middle of the frame" — naming the lines involved.

E2. BROKEN WORDS — no word may be split across two lines. FAIL if you see a word hyphen-less-
   wrapped mid-word, e.g. "Supports" rendered as "S" at the end of one line and "upports" at the
   start of the next, or "students" as "st" + "udents". Quote the exact broken word in the issue.
   A single quoted line from the explainer must appear on ONE visual line; if it wrapped at all,
   the font is too large for the frame — flag it so the next attempt shrinks the font.

E3. CRAMPED-IN-SHAPE — text inside a box or circle must have clear space between it and the
   outline on every side. FAIL if any text touches, overlaps, or is pressed right up against a
   box/circle border (e.g. the last character of "TARGET?" almost touching the circle's edge, or
   text not centered because it's too wide for the shape). Say which shape and to shrink the text.

E4. CROPPED GLYPHS & STRAY MARKS — look closely at punctuation and edges. FAIL if:
   - any letter or punctuation mark is cut off, clipped, or malformed (e.g. a "?" whose top is
     sliced off, or a letter with its descender cut),
   - there is a stray dot, mark, accent, or fragment on screen that is NOT part of the script's
     text (e.g. a small coloured dot sitting under a line), or
   - a character renders in a different colour than the rest of its word for no scripted reason.
   Name the exact text and the mark so the next attempt can remove/repair it.

F. COLOR FIDELITY — colors should match the explainer (e.g. "sky blue for DIAGNOSIS"
   means the DIAGNOSIS-related elements actually appear sky blue). Flag obvious color mismatches.
   Distinguish this from Check A — if an element is BOTH the wrong color AND dimmer than
   its peers, the root cause is A (animation cut off), not F.

G. AESTHETIC — if the explainer requests a hand-drawn aesthetic, the strokes should look
   hand-drawn (some imperfection is fine). Flag completely mechanical / generic appearance
   only if it clearly violates the requested style.

H. SPARSE / UNDERFILLED FRAME — the composition must FILL the frame. FAIL if the content
   (headline + boxes + lines together) occupies well under two-thirds of the vertical space
   between the top of the frame and the caption zone, leaving large empty bands above and/or
   below — a small cluster floating in darkness looks cheap. The issue must instruct:
   increase font sizes and the vertical gaps between blocks so the composition spans the
   safe area top to bottom — do NOT add new content.

Respond with ONLY a JSON object, no surrounding prose, no markdown fences:

{
  "pass": true | false,
  "issues": [ "specific actionable issue 1", "specific actionable issue 2", ... ]
}

Rules for issues:
- If pass is true, issues MUST be an empty array.
- Each issue is one concrete, actionable problem an HTML generator can fix.
  GOOD: "The text 'Non-parametric version of the t-test' appears faded grey while the
         surrounding white text is fully opaque — its write-in animation was cut off."
  GOOD: "The sky-blue DIAGNOSIS box is missing its right edge — only 3 sides are visible."
  GOOD: "The text 'Diagnosis' overlaps with the text '= AT the moment' inside the top box."
  GOOD: "Only the heading 'D662 Exam Tip' is visible; Steps 2–6 (the three Tier lines, the
         'Memory Hook:' line, and the yellow summary line) are entirely absent — the lower two-
         thirds of the frame is empty."
  GOOD: "The word 'Supports' is split across two lines — 'S' sits at the end of line one and
         'upports' wraps to line two. Shrink the font so 'Multi-Tiered System of Supports' fits
         on one line."
  BAD:  "The scene doesn't look great."     (vague — not actionable)
  BAD:  "Improve the layout."                (vague — not actionable)

- If a problem is borderline (e.g. minor stroke jitter), don't flag it. Only flag clear defects.
- For Check A issues, when describing the defect ALWAYS name the specific text/element so the
  generator can locate it — "the bottom-right box's description text appears faded" not
  "some text looks faded".`

export interface VisualReviewResult {
  pass: boolean
  issues: string[]
  rawResponse: string
}

export interface ReviewSceneArgs {
  apiKey: string
  model: string
  framePath: string
  explainer: string
  ratio: AspectRatio
}

export async function reviewScene(args: ReviewSceneArgs): Promise<VisualReviewResult> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })

  const imageBytes = await fs.readFile(args.framePath)
  const base64 = imageBytes.toString('base64')
  const mediaType = /\.png$/i.test(args.framePath) ? 'image/png' : 'image/jpeg'

  const resp = await client.messages.create({
    model: args.model || 'claude-opus-4-8',
    max_tokens: 1500,
    system: REVIEWER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64
            }
          },
          {
            type: 'text',
            text:
              `Aspect ratio: ${args.ratio}\n\n` +
              (args.ratio === '9:16' ? `${zoneGuideForReviewer()}\n\n` : '') +
              `Explainer:\n"""\n${args.explainer}\n"""\n\n` +
              `Review the attached final frame against this explainer. ` +
              `Return ONLY the JSON object as specified.`
          }
        ]
      }
    ]
  })

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
    .trim()

  return parseReviewerJson(text)
}

function parseReviewerJson(text: string): VisualReviewResult {
  let raw = text.trim()
  // Strip a code fence if Claude wrapped the JSON despite instructions.
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/, '').trim()
  }
  // Find the first { and the matching last }
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1)

  try {
    const parsed = JSON.parse(raw)
    const pass = parsed.pass === true
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(String).filter((s) => s.trim() !== '')
      : []
    // Defense-in-depth: if the reviewer claimed pass:true but ALSO listed issues,
    // honor the issues. Some Claude responses contradict themselves and the issues
    // are the more reliable signal.
    if (pass && issues.length > 0) {
      return { pass: false, issues, rawResponse: text }
    }
    return { pass, issues, rawResponse: text }
  } catch {
    // If parsing fails we now FAIL CLOSED instead of silently passing. A broken
    // reviewer response is exactly the kind of ambiguity that lets bad scenes
    // slip through; treat it as a fail with a synthetic issue, and the
    // generate-then-review loop will retry with the issue as feedback. The
    // runner caps retries via MAX_VISUAL_REVIEW_ATTEMPTS, so this can't loop
    // forever.
    return {
      pass: false,
      issues: [
        'Visual reviewer returned malformed JSON — could not confirm the scene is correct. ' +
          'Regenerating the HTML with extra attention to animation completeness and shape integrity.'
      ],
      rawResponse: text
    }
  }
}

/**
 * Last-line defence: strip the common looping constructs even if the prompt was ignored.
 * Returns the sanitized HTML and a list of what we changed so the runner can log it.
 *
 * Covers the realistic offenders:
 *   - CSS animation-iteration-count and the `infinite` keyword in the shorthand
 *   - GSAP timeline/tween repeat and yoyo
 *   - SVG <animate>/<animateMotion>/<animateTransform> repeatCount="indefinite"|N>1
 *   - Web Animations API element.animate(..., { iterations: Infinity | -1 | N>1 })
 *   - anime.js  loop: true | loop: N | direction: 'alternate' with loop
 *   - setInterval used for animation (can't auto-fix; logged as a warning)
 */
/**
 * CALM-REVEAL fallback: keep the scene's designed LAYOUT but replace ALL of
 * its motion with a system-authored staggered fade-in that cannot flicker.
 * Used when repeated repairs cannot cure a loop/flicker. The usual culprit is
 * a JS-driven show-then-hide sequence (word-highlight sweep, blink emphasis,
 * typewriter delete/retype): every tween plays "once", so sanitizeLoops has
 * nothing to neutralize and the defect only shows up in the rendered frames.
 * Here we delete every author <script> and SMIL animation, force everything
 * visible, and give each top-level block a single fade-in (ends visible,
 * fill both) — one animation per element, so flicker is impossible.
 */
export function injectCalmReveal(html: string, durationSeconds: number): string {
  let out = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<animate(?:Motion|Transform)?\b[^>]*\/>/gi, '')
    .replace(/<animate(?:Motion|Transform)?\b[^>]*>[\s\S]*?<\/animate(?:Motion|Transform)?>/gi, '')
  const totalReveal = Math.max(1.2, 0.7 * durationSeconds)
  const inject = `
<style>
  /* Neutralize every author animation. Transforms stay — they position things. */
  * { animation: none !important; transition: none !important; }
  /* Everything the calm reveal doesn't animate is simply visible. */
  *:not([data-calm]) { opacity: 1 !important; visibility: visible !important; }
  @keyframes calmIn { from { opacity: 0; } to { opacity: 1; } }
  /* No !important opacity on these elements — @keyframes cannot beat !important. */
  [data-calm] { visibility: visible !important; animation: calmIn 0.55s ease-out both !important; }
</style>
<script>
  (function () {
    var stage = document.querySelector('.safe')
    if (!stage) {
      var bodyKids = Array.prototype.slice.call(document.body.children).filter(function (el) {
        return el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT'
      })
      stage = bodyKids.length === 1 ? bodyKids[0] : document.body
    }
    var hops = 0
    while (stage && stage.children.length === 1 && hops < 4) { stage = stage.children[0]; hops++ }
    var kids = stage
      ? Array.prototype.slice.call(stage.children).filter(function (el) {
          return el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT'
        })
      : []
    if (kids.length < 2) return // single block — leave it fully visible
    var step = Math.min(0.9, Math.max(0.15, ${totalReveal.toFixed(2)} / kids.length))
    kids.forEach(function (el, i) {
      el.setAttribute('data-calm', '1')
      // inline !important beats the stylesheet shorthand's delay of 0s
      el.style.setProperty('animation-delay', (0.25 + i * step).toFixed(2) + 's', 'important')
    })
  })()
</script>`
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, inject + '\n</body>')
  else out += inject
  return out
}

export function sanitizeLoops(html: string): { html: string; sanitized: string[] } {
  const notes: string[] = []
  let out = html

  // ---- CSS animation-iteration-count ------------------------------------
  out = out.replace(/animation-iteration-count\s*:\s*infinite/gi, () => {
    notes.push('css: animation-iteration-count: infinite → 1')
    return 'animation-iteration-count: 1'
  })
  out = out.replace(/animation-iteration-count\s*:\s*(\d+)/gi, (m, n) => {
    if (parseInt(n, 10) > 1) {
      notes.push(`css: animation-iteration-count: ${n} → 1`)
      return 'animation-iteration-count: 1'
    }
    return m
  })

  // ---- CSS animation shorthand: drop `infinite` -------------------------
  out = out.replace(/(animation\s*:\s*[^;{}\n]*?)\binfinite\b([^;{}\n]*)/gi, (_m, a, b) => {
    notes.push('css: animation shorthand had `infinite` → removed')
    return `${a}${b}`
  })

  // ---- CSS keyframes that END INVISIBLE ----------------------------------
  // The rules above force every animation to a single pass — but a "pulse"
  // keyframe whose FINAL frame is opacity:0 / visibility:hidden / scale(0)
  // then plays once and leaves its element PERMANENTLY INVISIBLE. That is the
  // "line appears then vanishes; whole steps missing at the final frame"
  // disease. Rewrite the end state of every `to` / `…100%` keyframe to stay
  // visible (nothing is ever allowed to exit anyway).
  const fixEndState = (body: string): { body: string; changed: boolean } => {
    let changed = false
    let b = body.replace(/opacity\s*:\s*(0(?:\.\d+)?)(?![\d.])/gi, (mm, v) => {
      if (parseFloat(v) <= 0.25) {
        changed = true
        return 'opacity: 1'
      }
      return mm
    })
    b = b.replace(/visibility\s*:\s*hidden/gi, () => {
      changed = true
      return 'visibility: visible'
    })
    b = b.replace(/\bscale\s*\(\s*(0(?:\.\d+)?)\s*\)/gi, (mm, v) => {
      if (parseFloat(v) <= 0.25) {
        changed = true
        return 'scale(1)'
      }
      return mm
    })
    return { body: b, changed }
  }
  out = out.replace(/(\bto\s*\{)([^{}]*)(\})/g, (m, head, body, tail) => {
    const fixed = fixEndState(body)
    if (fixed.changed) {
      notes.push('css: @keyframes `to` frame ended invisible → forced visible')
      return `${head}${fixed.body}${tail}`
    }
    return m
  })
  out = out.replace(/((?:[\d.]+%\s*,\s*)*100(?:\.0+)?%\s*\{)([^{}]*)(\})/g, (m, head, body, tail) => {
    const fixed = fixEndState(body)
    if (fixed.changed) {
      notes.push('css: @keyframes `100%` frame ended invisible → forced visible')
      return `${head}${fixed.body}${tail}`
    }
    return m
  })

  // ---- GSAP: repeat: -1 / repeat: N>0 (object-literal form) --------------
  out = out.replace(/repeat\s*:\s*-?\d+/g, (m) => {
    const v = parseInt(m.split(':')[1].trim(), 10)
    if (v !== 0) {
      notes.push(`gsap: ${m.trim()} → repeat: 0`)
      return 'repeat: 0'
    }
    return m
  })

  // ---- GSAP: .repeat(-1) / .repeat(N>0) (chained method-call form) -------
  // e.g. gsap.timeline().repeat(-1) or tl.repeat(3) — not caught by the
  // object-literal rule above. Force the count to 0.
  out = out.replace(/\.repeat\s*\(\s*-?\d+\s*\)/g, (m) => {
    const v = parseInt(m.replace(/[^\-\d]/g, ''), 10)
    if (v !== 0) {
      notes.push(`gsap: ${m.trim()} → .repeat(0)`)
      return '.repeat(0)'
    }
    return m
  })

  // ---- GSAP: .yoyo(true) (chained method-call form) ---------------------
  out = out.replace(/\.yoyo\s*\(\s*true\s*\)/g, () => {
    notes.push('gsap: .yoyo(true) → .yoyo(false)')
    return '.yoyo(false)'
  })

  // ---- GSAP: yoyo: true -------------------------------------------------
  out = out.replace(/yoyo\s*:\s*true/g, () => {
    notes.push('gsap: yoyo: true → yoyo: false')
    return 'yoyo: false'
  })

  // ---- SVG <animate ... repeatCount="indefinite"|N> ---------------------
  // Catches <animate>, <animateMotion>, <animateTransform>, <animateColor>.
  out = out.replace(/repeatCount\s*=\s*(["'])indefinite\1/gi, (_m, q) => {
    notes.push('svg: repeatCount="indefinite" → "1"')
    return `repeatCount=${q}1${q}`
  })
  out = out.replace(/repeatCount\s*=\s*(["'])(\d+)\1/gi, (m, q, n) => {
    if (parseInt(n, 10) > 1) {
      notes.push(`svg: repeatCount="${n}" → "1"`)
      return `repeatCount=${q}1${q}`
    }
    return m
  })

  // ---- Web Animations API: { iterations: Infinity | -1 | N>1 } ----------
  out = out.replace(/iterations\s*:\s*Infinity/g, () => {
    notes.push('webanim: iterations: Infinity → 1')
    return 'iterations: 1'
  })
  out = out.replace(/iterations\s*:\s*-?\d+/g, (m) => {
    const v = parseInt(m.split(':')[1].trim(), 10)
    if (v !== 1) {
      notes.push(`webanim: ${m.trim()} → iterations: 1`)
      return 'iterations: 1'
    }
    return m
  })

  // ---- anime.js: loop: true | loop: -1 | loop: N>0 ----------------------
  out = out.replace(/loop\s*:\s*true/g, () => {
    notes.push('anime.js: loop: true → false')
    return 'loop: false'
  })
  out = out.replace(/loop\s*:\s*-?\d+/g, (m) => {
    const v = parseInt(m.split(':')[1].trim(), 10)
    if (v !== 0) {
      notes.push(`anime.js: ${m.trim()} → loop: false`)
      return 'loop: false'
    }
    return m
  })

  // ---- setInterval — can't safely auto-fix, just shout about it ---------
  if (/setInterval\s*\(/.test(out)) {
    notes.push('warning: setInterval is present in the HTML — Claude may have written a loop')
  }

  return { html: out, sanitized: notes }
}

function extractHtml(raw: string): string {
  let s = raw.trim()
  // Strip a leading code fence if present.
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n')
    if (firstNl >= 0) s = s.slice(firstNl + 1)
    const fenceEnd = s.lastIndexOf('```')
    if (fenceEnd >= 0) s = s.slice(0, fenceEnd)
    s = s.trim()
  }
  const start = s.toLowerCase().indexOf('<!doctype html')
  if (start > 0) s = s.slice(start)
  if (!/<!doctype html/i.test(s) || !/<\/html>/i.test(s)) {
    throw new Error('Claude did not return a complete HTML document.')
  }
  return s
}
