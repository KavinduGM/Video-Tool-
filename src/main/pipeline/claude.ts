import Anthropic from '@anthropic-ai/sdk'
import type { AspectRatio, ScriptSpec } from '@shared/types'
import { dimensionsForRatio } from './parser'

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
   - Letter-by-letter text write-on: stagger each <span> with a GSAP timeline (no repeat),
     or use CSS \`@keyframes\` with \`animation-delay\` per letter and \`animation-iteration-count: 1\`.

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

5b. STEP / BEAT TIMESTAMPS IN THE EXPLAINER ARE A MANDATORY CONTRACT.
    If the user's explainer contains lines like \`Step 1 (0.0 – 1.6s):\`, \`Beat 3 (2.4 – 4.0s):\`,
    \`at 5.5s: …\`, or any other explicit time markers, you MUST:
    - Honor each timestamp EXACTLY. The element described in Step 3 at 2.4s remains hidden
      before 2.4s and begins its reveal animation at exactly t = 2.4s.
    - Place every step in the timeline at its declared time, even if it means the early steps
      finish quickly and the later steps have to wait.
    - Do NOT condense the steps into the first few seconds and then leave the rest of the
      timeline empty. That is the most common failure mode and produces a video that looks
      like it loops or freezes.
    - Critically: every element's INITIAL CSS state must be the pre-reveal state (opacity: 0,
      or stroke-dashoffset = path length, or off-screen transform). Otherwise the element
      shows at frame 0 and your "reveal" is a no-op.

    Pick whichever animation technique fits — GSAP timeline with absolute time positions,
    CSS \`@keyframes\` with \`animation-delay\` per element (with \`animation-iteration-count: 1\`
    and \`animation-fill-mode: both\`), or anime.js with delay. The key is anchoring each step
    to its declared start time.

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
    The voiceover is a separate audio track played alongside.`

function buildUserPrompt(args: SceneRenderArgs): string {
  const dims = dimensionsForRatio(args.ratio)
  const style = args.style
    ? `\nStyle hints:\n- description: ${args.style.description ?? '(none)'}\n- colors: ${(args.style.colors ?? []).join(', ') || '(none)'}\n- fonts: ${(args.style.fonts ?? []).join(', ') || '(none)'}`
    : ''
  return `Build a single Hyperframes composition for scene ${args.sceneIndex + 1} of ${args.totalScenes}.

Aspect ratio: ${args.ratio}
Resolution: ${dims.width}x${dims.height}
Total duration (seconds): ${args.durationSeconds.toFixed(3)}
${style}

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

1. SCAN the explainer for explicit time markers like "Step N (a.a – b.b s):" or
   "Beat N (a.a – b.b s):" or "at N.N s:". If present, they are a MANDATORY CONTRACT:
   each described element must remain HIDDEN before its declared start time and begin
   its reveal animation EXACTLY at that start time. Hit every step. Do not bunch them.

2. If the explainer has NO time markers, plan at least
   ${Math.max(2, Math.ceil(args.durationSeconds / 2.5))} beats spread evenly across
   [0, ${args.durationSeconds.toFixed(2)}] yourself, one every 2–3 seconds.

3. CRITICAL — each element's INITIAL STATE in CSS must be the pre-reveal state
   (opacity: 0, or stroke-dashoffset = path length, or visibility: hidden, or transform:
   translate / scale that puts it off-screen / shrunk). Otherwise the element shows
   immediately at frame 0 and your "reveal animation" is a no-op — the screen ends up
   fully drawn at t=0 and looks frozen / looping for the remaining seconds. Double-check
   this for every element you add.

4. Use whatever technique you prefer to drive the reveals, but anchor each one to its
   declared start time. The two most reliable options:

   a) GSAP timeline with absolute time positions:
        const tl = gsap.timeline();
        tl.from('.el', { opacity: 0, duration: 0.6 }, START_TIME_SECONDS);
      Use \`.from()\` (animates FROM the given start state to the element's CSS final state)
      so you don't depend on CSS being pre-set. Or set CSS to the start state and use
      \`.to()\` to the final state. Either works — just be consistent.

   b) CSS @keyframes per element with \`animation-delay: <start>s;\` and
      \`animation-iteration-count: 1; animation-fill-mode: both;\` so the element holds
      both its initial state (before delay) and its final state (after animation ends).

5. The final 0.5–1.5 seconds is the settle hold. Everything is already visible by then.
   You MAY add ONE single-pass effect across the whole composition (slow zoom 1.00→1.02,
   slow pan, slow gradient drift) that ends exactly at ${args.durationSeconds.toFixed(2)}s.
   Single-pass, not looping.

6. No \`@keyframes\` rule on a visible element may omit \`animation-iteration-count: 1\`
   and \`animation-fill-mode\` (use \`forwards\` or \`both\`). No \`infinite\`.
   No \`repeat: -1\`. No \`repeatCount="indefinite"\`. No \`setInterval\` for visible motion.

7. If you can't fill ${args.durationSeconds.toFixed(2)} seconds with the listed steps,
   add supporting visuals consistent with the explainer (a callout, an arrow, a doodle,
   an accent). Never pad by repeating earlier motion.

Return ONLY the full HTML document, beginning with <!DOCTYPE html>.`
}

export interface SceneHtmlResult {
  html: string
  sanitized: string[]
}

export async function generateSceneHtml(args: SceneRenderArgs): Promise<SceneHtmlResult> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })

  const resp = await client.messages.create({
    model: args.model || 'claude-opus-4-7',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(args) }]
  })

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim()

  const html = extractHtml(text)
  return sanitizeLoops(html)
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
export function sanitizeLoops(html: string): SceneHtmlResult {
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

  // ---- GSAP: repeat: -1 / repeat: N>0 -----------------------------------
  out = out.replace(/repeat\s*:\s*-?\d+/g, (m) => {
    const v = parseInt(m.split(':')[1].trim(), 10)
    if (v !== 0) {
      notes.push(`gsap: ${m.trim()} → repeat: 0`)
      return 'repeat: 0'
    }
    return m
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
