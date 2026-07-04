// =====================================================================
// STORY TEMPLATE CARDS — 2-scene intro / 2-scene outro (storyboard style)
// =====================================================================
// Replicates the editor-designed storyboards: each video's intro is TWO
// scenes inside one segment (badge + hook + hero image, then statement +
// hero image), and the outro is TWO scenes (takeaway + hero image, then
// CTA + subscribe + arrow). A template SET defines the whole look — bg,
// font treatment, badge style, alignment, hero assets — and one video
// always uses one set for both intro and outro (hash-picked from the
// video name, overridable via `template_set:` in the script).
//
// Hero images are code-drawn flat SVGs for now; artist-uploaded PNGs per
// channel come later. Everything is composed deterministically: word
// reveals, the scene swap, image pops and idle floats are all computed —
// no AI, byte-identical output for the same input.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'

export interface StorySet {
  id: number
  name: string
  bg: string
  ink: string
  font: string
  weights: string
  caps: boolean
  italic: boolean
  spaced: boolean
  /** text alignment for scene text blocks */
  align: 'left' | 'right' | 'center'
  badge: { bg: string; ink: string }
  arrowColor: string
  assets: { intro1: AssetId; intro2: AssetId; outro1: AssetId }
}

export type AssetId =
  | 'house'
  | 'key'
  | 'bulb'
  | 'skyscraper'
  | 'books'
  | 'clipboard'
  | 'questions'

export const STORY_SETS: StorySet[] = [
  {
    id: 1,
    name: 'steel',
    bg: '#5B7C99',
    ink: '#FFFFFF',
    font: 'Nunito',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'right',
    badge: { bg: '#F2C9CC', ink: '#3A2A2C' },
    arrowColor: '#1F3A5F',
    assets: { intro1: 'house', intro2: 'key', outro1: 'bulb' }
  },
  {
    id: 2,
    name: 'navy',
    bg: '#1B3A75',
    ink: '#FFFFFF',
    font: 'Archivo',
    weights: '700;800;900',
    caps: true,
    italic: true,
    spaced: true,
    align: 'left',
    badge: { bg: '#101010', ink: '#FFFFFF' },
    arrowColor: '#A9C6E8',
    assets: { intro1: 'skyscraper', intro2: 'books', outro1: 'house' }
  },
  {
    id: 3,
    name: 'paper',
    bg: '#E9E4DE',
    ink: '#171310',
    font: 'Archivo',
    weights: '700;800;900',
    caps: true,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#FFFFFF', ink: '#171310' },
    arrowColor: '#D8342C',
    assets: { intro1: 'books', intro2: 'questions', outro1: 'clipboard' }
  },
  {
    id: 4,
    name: 'sky',
    bg: '#AECBEB',
    ink: '#14181F',
    font: 'Nunito',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#FFFFFF', ink: '#14181F' },
    arrowColor: '#3E2F28',
    assets: { intro1: 'clipboard', intro2: 'questions', outro1: 'bulb' }
  }
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Same seed → same set, so intro and outro always match. */
export function pickStorySet(seed: string, override?: number): StorySet {
  if (override && override >= 1) {
    return STORY_SETS[(override - 1) % STORY_SETS.length]
  }
  return STORY_SETS[hash(`story:${seed}`) % STORY_SETS.length]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------
// Flat SVG hero assets (code-drawn; artist PNGs come later)
// ---------------------------------------------------------------------
function assetSvg(id: AssetId, px: number): string {
  const W = px
  switch (id) {
    case 'house':
      return `<svg viewBox="0 0 200 180" width="${W}" aria-hidden="true">
  <polygon points="100,8 196,84 4,84" fill="#C4392E"/>
  <rect x="26" y="84" width="148" height="90" rx="4" fill="#F1E0C8"/>
  <rect x="52" y="118" width="30" height="56" rx="3" fill="#7A4B2A"/>
  <rect x="112" y="108" width="38" height="34" rx="3" fill="#9CC3E0"/>
  <line x1="131" y1="108" x2="131" y2="142" stroke="#F1E0C8" stroke-width="4"/>
  <line x1="112" y1="125" x2="150" y2="125" stroke="#F1E0C8" stroke-width="4"/>
</svg>`
    case 'key':
      return `<svg viewBox="0 0 140 260" width="${Math.round(W * 0.62)}" aria-hidden="true">
  <circle cx="70" cy="52" r="44" fill="#E8C766"/>
  <circle cx="70" cy="46" r="16" fill="${'#00000022'}"/>
  <rect x="56" y="92" width="28" height="130" rx="8" fill="#E8C766"/>
  <rect x="56" y="160" width="52" height="18" rx="6" fill="#E8C766"/>
  <rect x="56" y="196" width="42" height="18" rx="6" fill="#E8C766"/>
  <rect x="60" y="96" width="8" height="120" fill="#F5DE9A"/>
</svg>`
    case 'bulb':
      return `<svg viewBox="0 0 200 260" width="${Math.round(W * 0.8)}" aria-hidden="true">
  <circle cx="100" cy="100" r="86" fill="#F7D74C"/>
  <path d="M100 14 a86 86 0 0 1 60 25 l -30 30 a46 46 0 0 0 -30 -12 z" fill="#FBE68A"/>
  <path d="M78 150 q 10 -34 22 -34 q 12 0 22 34" stroke="#E0A63C" stroke-width="7" fill="none" stroke-linecap="round"/>
  <rect x="72" y="182" width="56" height="12" rx="6" fill="#A9A9A9"/>
  <rect x="76" y="198" width="48" height="12" rx="6" fill="#9C9C9C"/>
  <rect x="80" y="214" width="40" height="12" rx="6" fill="#8F8F8F"/>
  <path d="M88 232 h24 l-6 14 h-12 z" fill="#4C4C4C"/>
</svg>`
    case 'skyscraper': {
      let windows = ''
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 3; c++) {
          windows += `<rect x="${64 + c * 26}" y="${58 + r * 24}" width="16" height="14" rx="2" fill="#5E7FA6"/>`
        }
      }
      return `<svg viewBox="0 0 200 270" width="${Math.round(W * 0.78)}" aria-hidden="true">
  <rect x="52" y="40" width="96" height="220" rx="4" fill="#C9D6E3"/>
  <rect x="76" y="14" width="48" height="30" rx="3" fill="#B7C7D8"/>
  <rect x="94" y="0" width="12" height="18" fill="#9FB3C8"/>
  ${windows}
</svg>`
    }
    case 'books':
      return `<svg viewBox="0 0 240 190" width="${W}" aria-hidden="true">
  <rect x="20" y="130" width="200" height="44" rx="8" fill="#D9694F"/>
  <rect x="34" y="82" width="176" height="42" rx="8" fill="#4F7ED9"/>
  <rect x="48" y="36" width="150" height="40" rx="8" fill="#E3C93F"/>
  <rect x="20" y="140" width="200" height="8" fill="#00000022"/>
  <rect x="34" y="92" width="176" height="8" fill="#00000022"/>
  <rect x="48" y="46" width="150" height="8" fill="#00000022"/>
</svg>`
    case 'clipboard':
      return `<svg viewBox="0 0 200 250" width="${Math.round(W * 0.76)}" aria-hidden="true">
  <rect x="20" y="24" width="160" height="212" rx="14" fill="#F5F1E9" stroke="#C9BFAE" stroke-width="5"/>
  <rect x="72" y="8" width="56" height="30" rx="10" fill="#8E8578"/>
  <path d="M46 92 l12 12 22 -26" stroke="#3FA96C" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="94" y="84" width="70" height="10" rx="5" fill="#B9AF9E"/>
  <path d="M46 148 l12 12 22 -26" stroke="#3FA96C" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="94" y="140" width="70" height="10" rx="5" fill="#B9AF9E"/>
  <path d="M46 204 l12 12 22 -26" stroke="#3FA96C" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="94" y="196" width="70" height="10" rx="5" fill="#B9AF9E"/>
</svg>`
    case 'questions':
      return `<svg viewBox="0 0 240 200" width="${W}" aria-hidden="true">
  <text x="60" y="130" font-family="Arial Black, Arial, sans-serif" font-size="130" font-weight="900" fill="#7C5CC4">?</text>
  <text x="140" y="170" font-family="Arial Black, Arial, sans-serif" font-size="100" font-weight="900" fill="#9B7FE0">?</text>
</svg>`
  }
}

function arrowSvg(color: string, px: number): string {
  return `<svg viewBox="0 0 120 200" width="${Math.round(px * 0.5)}" aria-hidden="true">
  <path d="M60 8 L60 128" stroke="${color}" stroke-width="26" stroke-linecap="round" fill="none"/>
  <polygon points="18,120 102,120 60,188" fill="${color}"/>
</svg>`
}

// ---------------------------------------------------------------------
// Card composition
// ---------------------------------------------------------------------
export interface StoryCardSpec {
  kind: 'intro' | 'outro'
  scene1: string
  scene2: string
  /** channel name shown in the badge chip (intro scene 1 only) */
  badge?: string
  subscribe?: boolean
  durationSeconds: number
  set: StorySet
}

function textSizeFor(text: string): number {
  const len = text.length
  return len <= 20 ? 92 : len <= 32 ? 80 : len <= 48 ? 68 : 58
}

function wordSpans(text: string, from: number, to: number): { html: string; last: number } {
  const words = text.split(/\s+/).filter(Boolean)
  const n = words.length
  const step = n > 1 ? Math.min(0.3, Math.max(0.08, (to - from) / (n - 1))) : 0
  let last = from
  const html = words
    .map((w, i) => {
      const d = Math.min(from + i * step, to)
      last = Math.max(last, d)
      return `<span class="w" style="animation-delay:${d.toFixed(2)}s">${esc(w)}</span>`
    })
    .join(' ')
  return { html, last }
}

/**
 * Build a complete 2-scene intro or outro card. Scene 1 plays from 0 to the
 * split point, slides out, and scene 2 plays to the end. All reveals finish
 * before their scene ends; hero images pop in once and then float gently
 * (sub-pixel at audit scale). Pure and deterministic.
 */
export function buildStoryCardHtml(spec: StoryCardSpec): string {
  const { set } = spec
  const D = spec.durationSeconds
  if (!spec.scene1.trim() || !spec.scene2.trim()) throw new Error('story card: scene1/scene2 required')
  const tSplit = Math.min(Math.max(D * 0.45, 1.6), Math.max(1.6, D - 1.8))
  const m = NINE_SIXTEEN.margin

  // Scene 1 timings
  const badgeDelay = 0.15
  const s1 = wordSpans(spec.scene1, 0.35, Math.max(0.5, tSplit - 0.75))
  const hero1Delay = Math.min(0.55, Math.max(0.3, tSplit * 0.3))
  const exitDelay = Math.max(0.4, tSplit - 0.35)

  // Scene 2 timings
  const s2From = tSplit + 0.3
  const s2To = Math.max(s2From + 0.2, D - 0.95)
  const s2 = wordSpans(spec.scene2, s2From, spec.subscribe ? Math.min(s2To, D - 1.6) : s2To)
  const hero2Delay = tSplit + 0.4

  // Outro CTA timings
  const pillDelay = Math.min(s2.last + 0.45, Math.max(s2From, D - 1.25))
  const arrowDelay = Math.min(pillDelay + 0.35, Math.max(s2From, D - 0.9))
  const pulseDelay = Math.min(pillDelay + 0.7, D - 0.4)
  const bobDelay = Math.min(arrowDelay + 0.6, D - 0.4)

  const capsCss = set.caps ? 'text-transform:uppercase;' : ''
  const italicCss = set.italic ? 'font-style:italic;' : ''
  const spacedCss = set.spaced ? 'letter-spacing:3px;' : ''
  const alignCss =
    set.align === 'left' ? 'text-align:left;align-items:flex-start;' : set.align === 'right' ? 'text-align:right;align-items:flex-end;' : 'text-align:center;align-items:center;'

  const badgeHtml =
    spec.kind === 'intro' && spec.badge
      ? `<div class="badge" style="animation-delay:${badgeDelay.toFixed(2)}s">${esc(spec.badge)}</div>`
      : ''

  const hero1 = assetSvg(spec.kind === 'intro' ? set.assets.intro1 : set.assets.outro1, 520)
  const hero2Html =
    spec.kind === 'intro'
      ? `<div class="hero pop" style="animation-delay:${hero2Delay.toFixed(2)}s"><div class="float" style="animation-delay:${(hero2Delay + 0.8).toFixed(2)}s">${assetSvg(set.assets.intro2, 520)}</div></div>`
      : ''

  const ctaHtml = spec.subscribe
    ? `
      <div class="cta-pop" style="animation-delay:${pillDelay.toFixed(2)}s">
        <div class="sub" style="animation-delay:${pulseDelay.toFixed(2)}s">
          <span class="sub-label">SUBSCRIBE</span>
          <span class="sub-bell"><svg viewBox="0 0 24 24" width="36" height="36" fill="#E8412C" aria-hidden="true"><path d="M12 22a2.6 2.6 0 0 0 2.55-2.1h-5.1A2.6 2.6 0 0 0 12 22Zm7.3-5.2-1.7-1.75V10.9a5.7 5.7 0 0 0-4.2-5.5V4.7a1.4 1.4 0 0 0-2.8 0v.7a5.7 5.7 0 0 0-4.2 5.5v4.15L4.7 16.8A1 1 0 0 0 5.45 18.5h13.1a1 1 0 0 0 .75-1.7Z"/></svg></span>
        </div>
      </div>
      <div class="arrow-pop" style="animation-delay:${arrowDelay.toFixed(2)}s">
        <div class="bob" style="animation-delay:${bobDelay.toFixed(2)}s">${arrowSvg(set.arrowColor, 520)}</div>
      </div>`
    : ''

  const fontParam = set.font.trim().replace(/\s+/g, '+')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:ital,wght@0,${set.weights.split(';').join(';0,')};1,${set.weights.split(';').join(';1,')}&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${set.bg};font-family:'${set.font}',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;box-sizing:border-box}
  .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-start;gap:44px;${alignCss}}
  .sc1{animation:scOut .35s ease-in both;animation-delay:${exitDelay.toFixed(2)}s;animation-iteration-count:1}
  .sc2{opacity:0;animation:scIn .35s ease-out both;animation-delay:${tSplit.toFixed(2)}s;animation-iteration-count:1;justify-content:${spec.subscribe ? 'flex-start' : 'flex-start'}}
  .badge{display:inline-block;background:${set.badge.bg};color:${set.badge.ink};font-weight:800;font-size:34px;${capsCss}letter-spacing:2px;
         padding:12px 28px;border-radius:14px;margin-top:26px;opacity:0;animation:drop .45s cubic-bezier(.2,.8,.3,1.15) both;animation-iteration-count:1}
  .txt{color:${set.ink};font-weight:900;${capsCss}${italicCss}${spacedCss}line-height:1.16;max-width:100%;
       overflow-wrap:normal;word-break:keep-all;margin-top:18px}
  .w{display:inline-block;opacity:0;animation:wIn .38s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  .hero{margin-top:auto;align-self:center;opacity:0}
  .pop{animation:pop .55s cubic-bezier(.2,.85,.3,1.25) both;animation-iteration-count:1}
  .float{animation:float 3.2s ease-in-out infinite}
  .cta-pop{align-self:center;margin-top:34px;opacity:0;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) both;animation-iteration-count:1}
  .sub{display:inline-flex;align-items:center;gap:18px;background:#E8412C;border-radius:999px;padding:14px 18px 14px 32px;animation:pulse 2.4s ease-in-out infinite}
  .sub-label{color:#fff;font-weight:900;font-size:40px;letter-spacing:1px;font-style:normal}
  .sub-bell{width:60px;height:60px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
  .arrow-pop{align-self:center;margin-top:30px;opacity:0;animation:wIn .5s ease-out both;animation-iteration-count:1}
  .bob{animation:bob 1.6s ease-in-out infinite}
  @keyframes wIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
  @keyframes drop{from{opacity:0;transform:translateY(-26px)}to{opacity:1;transform:none}}
  @keyframes pop{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}
  @keyframes scOut{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-70px)}}
  @keyframes scIn{from{opacity:0;transform:translateX(70px)}to{opacity:1;transform:none}}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(12px)}}
  @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(12px)}}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${D.toFixed(3)}">
  <div class="safe">
    <div class="scene sc1">
      ${badgeHtml}
      <div class="txt" style="font-size:${textSizeFor(spec.scene1)}px">${s1.html}</div>
      <div class="hero pop" style="animation-delay:${hero1Delay.toFixed(2)}s"><div class="float" style="animation-delay:${(hero1Delay + 0.8).toFixed(2)}s">${hero1}</div></div>
    </div>
    <div class="scene sc2">
      <div class="txt" style="font-size:${textSizeFor(spec.scene2)}px;margin-top:60px">${s2.html}</div>
      ${spec.kind === 'intro' ? hero2Html : ctaHtml}
    </div>
  </div>
</div>
</body>
</html>`
}
