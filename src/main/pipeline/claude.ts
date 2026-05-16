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
   - Never use GSAP \`repeat: -1\`, \`repeat: N\` > 0, or \`yoyo: true\` with repeats.
   - Never use CSS \`animation-iteration-count: infinite\` or any value other than \`1\`.
   - Every \`@keyframes\` rule applied to a visible element MUST be paired with
     \`animation-iteration-count: 1\` explicitly. Do NOT rely on defaults.
   - Never use \`setInterval\` for animation. \`setTimeout\` is allowed only for scheduling
     one-shot reveals — never for repeated motion.
   - Every animation runs exactly once, ends in its final visual state, and stays in that state.

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

Before you write any animation code, plan internally:

1. List the distinct beats / SECTIONS in the explainer in order. Plan at least
   ${Math.max(2, Math.ceil(args.durationSeconds / 2.5))} beats total across the ${args.durationSeconds.toFixed(2)}-second timeline,
   one beat every 2–3 seconds. If the explainer doesn't provide that many beats explicitly,
   subdivide each section into smaller sub-beats (e.g. "title writes in", "underline draws",
   "subtitle writes in" are three beats inside one opening section).

2. Assign each beat a start time and a length so they tile [0, ${args.durationSeconds.toFixed(2)}]
   with no gaps and no overlap (except optional 0.3–0.6s crossfades). The last beat should end
   at approximately ${(args.durationSeconds - 0.8).toFixed(2)} seconds, leaving a ~0.8 s settle hold.

3. During the settle hold (final ~0.8 s) you MAY add ONE gentle single-pass effect such as
   a very slow zoom (scale 1 → 1.02), a slow pan, or a slow gradient drift — but it must run
   exactly once and end exactly at ${args.durationSeconds.toFixed(2)} seconds. NEVER loop it.

4. Then write the HTML. Every animation runs exactly once. Every \`@keyframes\` user must set
   \`animation-iteration-count: 1\` explicitly. No \`repeat: -1\`. No \`infinite\`.

5. If you cannot think of enough content to fill ${args.durationSeconds.toFixed(2)} seconds,
   INVENT supporting visuals consistent with the explainer (decorative annotations, supporting
   bullets, a callout arrow, a count-up number, an icon). Do NOT pad by repeating earlier motion.

Return ONLY the full HTML document.`
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
 */
export function sanitizeLoops(html: string): SceneHtmlResult {
  const notes: string[] = []
  let out = html

  // CSS: animation-iteration-count: infinite | N (>1)  →  1
  out = out.replace(/animation-iteration-count\s*:\s*infinite/gi, (m) => {
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

  // CSS shorthand: `animation: ... infinite ...`  → strip the "infinite" token.
  // Only inside `animation:` declarations (rough heuristic: match whole declaration line).
  out = out.replace(/(animation\s*:\s*[^;{}\n]*?)\binfinite\b([^;{}\n]*)/gi, (m, a, b) => {
    notes.push('css: animation shorthand had `infinite` → removed')
    return `${a}${b}`
  })

  // GSAP: repeat: -1 | repeat: N>0
  out = out.replace(/repeat\s*:\s*-?\d+/g, (m) => {
    const v = parseInt(m.split(':')[1].trim(), 10)
    if (v !== 0) {
      notes.push(`gsap: ${m.trim()} → repeat: 0`)
      return 'repeat: 0'
    }
    return m
  })

  // GSAP: yoyo: true  (only meaningful with repeat — but flag anyway)
  out = out.replace(/yoyo\s*:\s*true/g, () => {
    notes.push('gsap: yoyo: true → yoyo: false')
    return 'yoyo: false'
  })

  // setInterval used for animation — we can't safely auto-fix this, just note it.
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
