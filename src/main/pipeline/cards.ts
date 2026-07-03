// =====================================================================
// DETERMINISTIC ANIMATED TITLE CARDS (intro / outro)
// =====================================================================
// Claude authoring a full animated typographic card from scratch proved
// unreliable (dropped lines, invented content, flicker) — the static
// fallback kept firing. This module builds the animated card ENTIRELY in
// code, the same way the proven subscribe outro is built:
//
//   - word-by-word reveal (each word its own span, CSS one-pass animation
//     with a computed delay — all finishing well before the end)
//   - a rounded accent HIGHLIGHT that sweeps in behind the EXAM NAME
//     (the first on-screen line — always highlighted, it's the video's
//     key), plus any extra phrases the script lists under `highlight:`
//   - several style presets (background / ink / accent / font) chosen
//     deterministically from the video name, so different videos vary
//     but the intro and outro of one video always match
//   - optional SUBSCRIBE button + red down arrow (outro CTA)
//
// Everything is computed: timings, sizes, colors. No AI in the loop, so
// the card renders correctly on the first attempt virtually every time.
// This file has no Electron imports so its output is directly testable.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'

export interface AnimatedCardSpec {
  onScreen: string
  durationSeconds: number
  /** extra phrases to highlight (the first line is always highlighted) */
  highlights?: string[]
  /** outro CTA: SUBSCRIBE button + red down arrow after the text */
  subscribe?: boolean
  /** style seed — use the video name so intro & outro share one preset */
  seed: string
}

export interface CardPreset {
  name: string
  bg: string
  ink: string
  accent: string
  font: string
}

export const CARD_PRESETS: CardPreset[] = [
  { name: 'cream-coral', bg: '#F4EFE6', ink: '#1A1A1A', accent: '#F3A79B', font: 'Poppins' },
  { name: 'sand-butter', bg: '#FAF1E4', ink: '#201A14', accent: '#FFD66B', font: 'Montserrat' },
  { name: 'porcelain-sky', bg: '#EFF3F8', ink: '#14213D', accent: '#A7D3F5', font: 'Poppins' },
  { name: 'blush-rose', bg: '#FAF0EC', ink: '#2B1B22', accent: '#F5B8C4', font: 'Montserrat' }
]

export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickPreset(seed: string): CardPreset {
  return CARD_PRESETS[hashSeed(seed) % CARD_PRESETS.length]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function norm(w: string): string {
  return w.toLowerCase().replace(/[.,!?;:'"()]/g, '')
}

interface LineSpec {
  words: string[]
  fontSize: number
  isFirst: boolean
  /** word indices (within the line) covered by an explicit highlight chip */
  chipRanges: { start: number; end: number }[]
}

/**
 * Build the complete animated card HTML. Pure and deterministic — same input,
 * same output. All animation delays are computed so every reveal FINISHES by
 * durationSeconds − 0.3 (nothing is ever mid-flight at the end, nothing loops).
 */
export function buildAnimatedCardHtml(spec: AnimatedCardSpec): string {
  const D = spec.durationSeconds
  const preset = pickPreset(spec.seed)
  const m = NINE_SIXTEEN.margin

  const rawLines = spec.onScreen
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  if (rawLines.length === 0) throw new Error('animated card: on_screen has no lines')

  // --- Line specs: sizes + explicit highlight ranges -------------------
  const highlightPhrases = (spec.highlights ?? [])
    .map((p) => p.trim().split(/\s+/).map(norm).filter(Boolean))
    .filter((p) => p.length > 0)

  const lines: LineSpec[] = rawLines.map((text, li) => {
    const words = text.split(/\s+/)
    let fontSize: number
    if (li === 0) {
      // The exam-name line: one visual row inside its chip, sized to fit.
      fontSize = Math.max(44, Math.min(96, Math.floor(880 / (0.62 * text.length))))
    } else {
      fontSize = text.length <= 16 ? 84 : text.length <= 26 ? 72 : text.length <= 38 ? 62 : 54
    }
    // Explicit highlight phrases (word-sequence match, punctuation-insensitive).
    const chipRanges: { start: number; end: number }[] = []
    if (li > 0 && highlightPhrases.length > 0) {
      const normWords = words.map(norm)
      for (const phrase of highlightPhrases) {
        for (let i = 0; i + phrase.length <= normWords.length; i++) {
          if (phrase.every((p, k) => normWords[i + k] === p)) {
            chipRanges.push({ start: i, end: i + phrase.length - 1 })
            break
          }
        }
      }
    }
    return { words, fontSize, isFirst: li === 0, chipRanges }
  })

  // --- Timing: word delays spread across the timeline ------------------
  const totalWords = lines.reduce((n, l) => n + l.words.length, 0)
  const t0 = 0.35
  const lastAllowed = Math.max(t0, D - 0.9)
  const step =
    totalWords > 1
      ? Math.min(0.34, Math.max(0.1, (Math.min(lastAllowed, D * 0.72) - t0) / (totalWords - 1)))
      : 0
  const delayOf = (globalIdx: number) => Math.min(t0 + globalIdx * step, lastAllowed)
  const sweepClamp = (t: number) => Math.min(t, Math.max(t0, D - 0.75))

  // --- Compose lines ----------------------------------------------------
  let wordIdx = 0
  const lineHtml: string[] = []
  let lastWordDelay = t0
  for (const line of lines) {
    const spans: string[] = []
    const wordDelays: number[] = []
    for (const w of line.words) {
      const d = delayOf(wordIdx++)
      wordDelays.push(d)
      lastWordDelay = Math.max(lastWordDelay, d)
      spans.push(`<span class="w" style="animation-delay:${d.toFixed(2)}s">${esc(w)}</span>`)
    }
    if (line.isFirst) {
      // Whole exam-name line inside one accent chip; sweep lands as its last word does.
      const sweep = sweepClamp(wordDelays[wordDelays.length - 1] + 0.32)
      lineHtml.push(
        `      <div class="ln ln1" style="font-size:${line.fontSize}px"><span class="hl"><i class="hlbg" style="animation-delay:${sweep.toFixed(2)}s"></i><span class="hlt">${spans.join(' ')}</span></span></div>`
      )
    } else if (line.chipRanges.length > 0) {
      // Wrap each explicit phrase in its own chip; keep other words plain.
      const parts: string[] = []
      let i = 0
      while (i < line.words.length) {
        const range = line.chipRanges.find((r) => r.start === i)
        if (range) {
          const chipSpans = spans.slice(range.start, range.end + 1).join(' ')
          const sweep = sweepClamp(wordDelays[range.end] + 0.32)
          parts.push(
            `<span class="hl"><i class="hlbg" style="animation-delay:${sweep.toFixed(2)}s"></i><span class="hlt">${chipSpans}</span></span>`
          )
          i = range.end + 1
        } else {
          parts.push(spans[i])
          i++
        }
      }
      lineHtml.push(`      <div class="ln" style="font-size:${line.fontSize}px">${parts.join(' ')}</div>`)
    } else {
      lineHtml.push(`      <div class="ln" style="font-size:${line.fontSize}px">${spans.join(' ')}</div>`)
    }
  }

  // --- Subscribe CTA (outro) --------------------------------------------
  let ctaHtml = ''
  if (spec.subscribe) {
    const btnDelay = Math.min(lastWordDelay + 0.5, Math.max(t0, D - 1.3))
    const arrowDelay = Math.min(btnDelay + 0.4, Math.max(t0, D - 0.9))
    ctaHtml = `
    <div class="sub" style="animation-delay:${btnDelay.toFixed(2)}s">
      <span class="sub-label">SUBSCRIBE</span>
      <span class="sub-bell">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="#17171A" aria-hidden="true"><path d="M12 22a2.6 2.6 0 0 0 2.55-2.1h-5.1A2.6 2.6 0 0 0 12 22Zm7.3-5.2-1.7-1.75V10.9a5.7 5.7 0 0 0-4.2-5.5V4.7a1.4 1.4 0 0 0-2.8 0v.7a5.7 5.7 0 0 0-4.2 5.5v4.15L4.7 16.8A1 1 0 0 0 5.45 18.5h13.1a1 1 0 0 0 .75-1.7Z"/></svg>
      </span>
    </div>
    <svg class="arrow" style="animation-delay:${arrowDelay.toFixed(2)}s" viewBox="0 0 120 210" width="130" height="195" aria-hidden="true">
      <path d="M60 14 L60 158" stroke="#E8412C" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M20 124 L60 176 L100 124" stroke="#E8412C" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`
  }

  const fontParam = preset.font.trim().replace(/\s+/g, '+')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@700;800;900&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${preset.bg};font-family:'${preset.font}',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:38px;box-sizing:border-box}
  .ln{color:${preset.ink};font-weight:800;line-height:1.14;text-align:center;max-width:100%;
      overflow-wrap:normal;word-break:keep-all}
  .ln1{white-space:nowrap;font-weight:900}
  .w{display:inline-block;opacity:0;animation:wIn .4s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  .hl{position:relative;display:inline-block;white-space:nowrap;padding:6px 22px}
  .hlbg{position:absolute;inset:0;background:${preset.accent};border-radius:18px;transform:scaleX(0);
        transform-origin:left center;animation:sweep .38s cubic-bezier(.25,.8,.3,1) both;animation-iteration-count:1;z-index:0}
  .hlt{position:relative;z-index:1}
  .sub{display:inline-flex;align-items:center;gap:20px;background:#17171A;border-radius:999px;
       padding:16px 20px 16px 36px;opacity:0;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) both;animation-iteration-count:1}
  .sub-label{color:#fff;font-weight:900;font-size:42px;letter-spacing:1px}
  .sub-bell{width:66px;height:66px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
  .arrow{opacity:0;animation:wIn .5s ease-out both;animation-iteration-count:1}
  @keyframes wIn{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
  @keyframes sweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes pop{0%{opacity:0;transform:scale(.82)}100%{opacity:1;transform:scale(1)}}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${D.toFixed(3)}">
  <div class="safe">
${lineHtml.join('\n')}${ctaHtml}
  </div>
</div>
</body>
</html>`
}
