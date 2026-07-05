// =====================================================================
// STORY TEMPLATE CARDS — 2-scene intro / 2-scene outro (storyboard style)
// =====================================================================
// The State Exams Prep template pack (10 sets). PRODUCTION MODEL, settled
// while fine-tuning Set 3:
//
//   1. BACKDROP-FIRST: the designer exports each card's full 1080×1920
//      frame WITHOUT texts as template-assets/set-<id>/<card>_bg.png.
//      The frame renders full-bleed with the camera-jitter drift; the
//      system animates badge, scene texts, subscribe pill and the
//      self-drawing arrow on top at positions MEASURED from the exact
//      design frames (per-set `layouts`).
//   2. Hero-slot PNGs (<card>_hero.png, auto-trimmed cutouts) remain a
//      supported alternative — a card uses its backdrop when present,
//      else its hero PNG, else legacy code-drawn SVG art.
//   3. Auto-pick rotation includes ONLY sets with real uploaded designs;
//      one video always uses one set for both intro and outro
//      (hash-picked from the video name, `template_set:` overrides).
//
// Set 3 ("stone") is fully measured and production-ready. The other
// sets keep neutral default layouts until their design frames arrive
// and get their own measuring pass. Everything is composed
// deterministically — no AI, byte-identical output for the same input.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'

export type AssetId =
  | 'house'
  | 'key'
  | 'bulb'
  | 'skyscraper'
  | 'tower'
  | 'books'
  | 'clipboard'
  | 'questions'
  | 'jeep'
  | 'facade'
  | 'docpencil'
  | 'checkcircle'
  | 'branch'
  | 'roof'
  | 'magnifier'
  | 'handshake'

export type ArrowStyle = 'block' | 'thin' | 'curved' | 'slim'
export type PillStyle = 'light' | 'dark' | 'outline' | 'subscribed'

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
  badge: { bg: string; ink: string; spaced?: boolean }
  arrowStyle: ArrowStyle
  arrowColor: string
  pill: PillStyle
  /** underline treatment on the intro scene-2 text (set 5 storyboard) */
  underline2?: boolean
  /** code-drawn fallback heroes, used for any slot whose PNG is not uploaded */
  assets: { intro1: AssetId; intro2: AssetId; outro1: AssetId }
  /** optional small coded hero above the subscribe pill (set 1's jeep) */
  outro2Asset?: AssetId
  /**
   * ALL sets are PNG-first: the artist's storyboard PNGs in
   * template-assets/set-<id>/ fill the hero slots. assetMode 'image' is the
   * norm; sets whose code-drawn art is a usable stand-in set svgFallbackOk so
   * they keep working (and stay in auto-pick) before their PNGs are uploaded.
   */
  assetMode?: 'svg' | 'image'
  svgFallbackOk?: boolean
  /** the PNG filename expected in each hero slot (outro2 is always optional) */
  imageSlots?: { intro1: string; intro2: string; outro1: string; outro2: string }
  /**
   * Per-card layout overrides, tuned from the storyboard. Anything not
   * specified falls back to the generic layout (text top, hero large and
   * bottom-centered).
   */
  layouts?: Partial<Record<CardKey, CardLayout>>
}

export type CardKey = 'intro1' | 'intro2' | 'outro1' | 'outro2'

export interface HeroLayout {
  /** slot box size in px (box mode; w is ignored in fit:'height' mode) */
  w?: number
  h: number
  /** horizontal anchor: centered, or bleeding off the left/right frame edge */
  x: 'center' | 'left-bleed' | 'right-bleed'
  /** how far past the frame edge a bleed extends (px) */
  bleed?: number
  /** vertical anchor (px relative to the safe area) — set exactly one */
  bottom?: number
  top?: number
  /**
   * fit:'height' — the design-exact mode for cut-off photos: the image is
   * scaled to EXACTLY h px tall (width follows the PNG's own proportions)
   * and one visible edge is PINNED at the measured design position via
   * left/right (px from the frame edge, may be negative). The far side
   * runs long and is clipped by the frame, exactly like the storyboard's
   * cut arm/sleeve — so any PNG crop renders at design scale and position.
   */
  fit?: 'height'
  left?: number
  right?: number
}

export interface CardLayout {
  /** pushes the text block down from the safe top (px) */
  padTop: number
  /** per-card text alignment override (default: the set's align) */
  textAlign?: 'left' | 'right' | 'center'
  /** fixed scene-text font size (px), measured from the storyboard — overrides the length tiers */
  fontPx?: number
  /** badge chip font size (px) when the storyboard uses an oversized badge */
  badgeFontPx?: number
  /** extra left padding on the card (px) when the storyboard insets content past the safe edge */
  padLeft?: number
  /** absolute text-block top (px, safe-relative; may be negative to sit above the safe line) — replaces flow positioning */
  txtTop?: number
  /** outro-2 CTA: absolute pill top (px, safe-relative) */
  pillTop?: number
  /** outro-2 CTA: pill font size (px) when the design uses an oversized pill */
  pillFontPx?: number
  /** outro-2 CTA: absolute arrow top (px, safe-relative) */
  arrowTop?: number
  /** outro-2 CTA: exact arrow height (px) — replaces the flow-computed fit */
  arrowH?: number
  /** the design text length (chars) fontPx was measured at — longer texts shrink from here (default 30) */
  fontBaseChars?: number
  /** badge chip alignment on intro scene 1 (default left) */
  badgeAlign?: 'left' | 'center'
  hero?: HeroLayout
}

/**
 * The measured storyboard font, gently shrunk for texts longer than the
 * storyboard's (~30 chars) so per-video lines wrap like the board instead of
 * overflowing. Short texts render at the exact measured size.
 */
export function effectiveFontPx(fontPx: number, text: string, baseChars = 30): number {
  return Math.min(fontPx, Math.round((fontPx * baseChars) / Math.max(baseChars, text.length)))
}

/** Generic storyboard layout: text at the top, hero large and bottom-center. */
export const DEFAULT_CARD_LAYOUTS: Record<CardKey, CardLayout> = {
  intro1: { padTop: 0, hero: { w: 780, h: 720, x: 'center', bottom: -160 } },
  intro2: { padTop: 40, hero: { w: 660, h: 620, x: 'center', bottom: -60 } },
  outro1: { padTop: 0, hero: { w: 680, h: 640, x: 'center', bottom: 120 } },
  outro2: { padTop: 40 }
}

const STD_SLOTS = {
  intro1: 'intro1_hero.png',
  intro2: 'intro2_hero.png',
  outro1: 'outro1_hero.png',
  outro2: 'outro2_hero.png'
}

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
    arrowStyle: 'block',
    arrowColor: '#1F3A5F',
    pill: 'light',
    assets: { intro1: 'house', intro2: 'key', outro1: 'bulb' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-1 design frames (backdrop-first;
    // hero entries are legacy-mode only). Safe-relative coordinates.
    // intro1: badge ~y160 font≈96, right-aligned title ≈160px from y≈390 (flow);
    // intro2: LEFT-aligned text starting above the safe line (abs y≈106);
    // outro1: left text at abs y≈192; outro2: centered text abs y≈205,
    // pill abs y≈939 font≈84, block arrow abs y≈1210 height≈445.
    layouts: {
      intro1: {
        padTop: 0,
        fontPx: 160,
        badgeFontPx: 96,
        hero: { w: 950, h: 660, x: 'center', top: 1097 }
      },
      intro2: {
        padTop: 0,
        txtTop: -54,
        textAlign: 'left',
        padLeft: 15,
        fontPx: 160,
        hero: { w: 460, h: 860, x: 'center', top: 670 }
      },
      outro1: {
        padTop: 0,
        txtTop: 32,
        textAlign: 'left',
        padLeft: 15,
        fontPx: 160,
        hero: { w: 640, h: 890, x: 'center', top: 695 }
      },
      outro2: {
        padTop: 0,
        txtTop: 45,
        textAlign: 'center',
        fontPx: 148,
        pillTop: 779,
        pillFontPx: 84,
        arrowTop: 1050,
        arrowH: 445
      }
    }
  },
  {
    id: 2,
    name: 'cobalt',
    bg: '#1668E3',
    ink: '#FFFFFF',
    font: 'Poppins',
    weights: '700;800',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#101010', ink: '#FFFFFF' },
    arrowStyle: 'slim',
    arrowColor: '#101010',
    pill: 'light',
    assets: { intro1: 'facade', intro2: 'docpencil', outro1: 'checkcircle' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-2 design frames (backdrop-first).
    // Centered composition: black badge centered at abs y≈281 (font 92),
    // titles centered (intro1 abs y≈555 @142/21ch · intro2 abs y≈237
    // @124/39ch · outro1 abs y≈293 @132/20ch · outro2 abs y≈172 @122/43ch);
    // pill abs y≈939 font 82; SLIM arrow (thin shaft, solid head) abs
    // y≈1221, height 520.
    layouts: {
      intro1: {
        padTop: 121,
        badgeFontPx: 92,
        badgeAlign: 'center',
        txtTop: 395,
        fontPx: 142,
        fontBaseChars: 21,
        hero: { w: 900, h: 900, x: 'center', top: 800 }
      },
      intro2: {
        padTop: 0,
        txtTop: 77,
        fontPx: 124,
        fontBaseChars: 39,
        hero: { w: 520, h: 660, x: 'center', top: 945 }
      },
      outro1: {
        padTop: 0,
        txtTop: 133,
        fontPx: 132,
        fontBaseChars: 20,
        hero: { w: 700, h: 700, x: 'center', top: 840 }
      },
      outro2: {
        padTop: 0,
        txtTop: 12,
        fontPx: 122,
        fontBaseChars: 43,
        pillTop: 779,
        pillFontPx: 82,
        arrowTop: 1061,
        arrowH: 520
      }
    }
  },
  {
    id: 3,
    name: 'stone',
    bg: '#DCD8D3',
    ink: '#17130F',
    font: 'Archivo',
    weights: '700;800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#101010', ink: '#FFFFFF' },
    arrowStyle: 'curved',
    arrowColor: '#17130F',
    pill: 'light',
    assets: { intro1: 'house', intro2: 'key', outro1: 'bulb' }, // svg fallback only
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    // PRODUCTION-READY (user-approved). Measured from the exact 1080×1920
    // design frames; runs backdrop-first from template-assets/set-3/*_bg.png.
    // Hero-layout entries below only matter for the legacy hero-PNG mode.
    layouts: {
      // Measured from the user's exact 1080×1920 design frames:
      // badge y=298 font≈100 · title y≈560 font≈130 · hand strip abs
      // y 1227–1766 cut AT the right edge · scene-2 image abs y 247–947
      // bleeding left · scene-2 text top≈1171 font≈138 right-aligned.
      intro1: {
        padTop: 140,
        padLeft: 16,
        fontPx: 130,
        badgeFontPx: 92, // 100 measured, but 92 guarantees ONE line (nowrap) inside the safe width
        hero: { h: 560, x: 'right-bleed', fit: 'height', left: 130, top: 1055 }
      },
      intro2: {
        padTop: 990,
        textAlign: 'right',
        fontPx: 138,
        hero: { h: 700, x: 'left-bleed', fit: 'height', right: 150, top: 87 }
      },
      outro1: { padTop: 20, hero: { w: 620, h: 750, x: 'center', bottom: -20 } },
      outro2: { padTop: 430, textAlign: 'center' }
    }
  },
  {
    id: 4,
    name: 'breeze',
    bg: '#B8CFE8',
    ink: '#3B2B23',
    font: 'Baloo 2',
    weights: '600;700;800',
    caps: true,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#E8D44D', ink: '#3B2B23' },
    arrowStyle: 'curved',
    arrowColor: '#6E6E6E',
    pill: 'subscribed',
    assets: { intro1: 'house', intro2: 'branch', outro1: 'roof' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS
  },
  {
    id: 5,
    name: 'slate',
    bg: '#C9D4DE',
    ink: '#101010',
    font: 'Oswald',
    weights: '500;600;700',
    caps: false,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#9FD8CE', ink: '#17342F' },
    arrowStyle: 'block',
    arrowColor: '#101010',
    pill: 'outline',
    underline2: true,
    assets: { intro1: 'magnifier', intro2: 'handshake', outro1: 'clipboard' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS
  },
  {
    id: 6,
    name: 'navy',
    bg: '#1B3A75',
    ink: '#FFFFFF',
    font: 'Archivo',
    weights: '700;800;900',
    caps: true,
    italic: true,
    spaced: true,
    align: 'left',
    badge: { bg: '#101010', ink: '#FFFFFF', spaced: true },
    arrowStyle: 'block',
    arrowColor: '#A9C6E8',
    pill: 'subscribed',
    assets: { intro1: 'tower', intro2: 'skyscraper', outro1: 'house' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS
  },
  {
    id: 7,
    name: 'lavender',
    bg: '#DDDEED',
    ink: '#101010',
    font: 'Poppins',
    weights: '700;800',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#FFFFFF', ink: '#101010', spaced: true },
    arrowStyle: 'thin',
    arrowColor: '#101010',
    pill: 'outline',
    assets: { intro1: 'books', intro2: 'questions', outro1: 'clipboard' },
    assetMode: 'image',
    imageSlots: STD_SLOTS
  },
  {
    id: 8,
    name: 'paper',
    bg: '#E5E0D8',
    ink: '#171310',
    font: 'Archivo',
    weights: '700;800;900',
    caps: true,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#FFFFFF', ink: '#171310', spaced: true },
    arrowStyle: 'curved',
    arrowColor: '#D8342C',
    pill: 'dark',
    assets: { intro1: 'books', intro2: 'questions', outro1: 'clipboard' },
    assetMode: 'image',
    imageSlots: STD_SLOTS
  },
  {
    id: 9,
    name: 'skyday',
    bg: '#A9C8E8',
    ink: '#14181F',
    font: 'Archivo',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#FFFFFF', ink: '#14181F', spaced: true },
    arrowStyle: 'curved',
    arrowColor: '#3E2F28',
    pill: 'subscribed',
    assets: { intro1: 'questions', intro2: 'books', outro1: 'clipboard' },
    assetMode: 'image',
    imageSlots: STD_SLOTS
  },
  {
    id: 10,
    name: 'mono',
    bg: '#EDEDEB',
    ink: '#111111',
    font: 'Quicksand',
    weights: '600;700',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#FFFFFF', ink: '#111111', spaced: true },
    arrowStyle: 'block',
    arrowColor: '#111111',
    pill: 'light',
    assets: { intro1: 'skyscraper', intro2: 'tower', outro1: 'house' },
    assetMode: 'image',
    imageSlots: STD_SLOTS
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

/**
 * Same seed → same set, so intro and outro always match. The auto-pick pool
 * is ONLY the sets whose real designs are uploaded (backdrop or hero PNGs —
 * the runner passes those ids); my code-drawn stand-ins never ship in
 * production rotation. If NOTHING is uploaded yet, fall back to the
 * svgFallbackOk stand-ins so a job still completes. Explicit template_set
 * overrides everything.
 */
export function pickStorySet(seed: string, override?: number, availableImageSets: number[] = []): StorySet {
  if (override && override >= 1) {
    return STORY_SETS[(override - 1) % STORY_SETS.length]
  }
  let pool = STORY_SETS.filter((s) => availableImageSets.includes(s.id))
  if (pool.length === 0) pool = STORY_SETS.filter((s) => s.svgFallbackOk)
  if (pool.length === 0) pool = STORY_SETS
  return pool[hash(`story:${seed}`) % pool.length]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------
// Flat SVG hero assets (code-drawn; artist PNGs fill the image sets)
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
  <circle cx="70" cy="46" r="16" fill="#00000022"/>
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
    case 'tower': {
      // Art-deco stepped tower with observation deck (set 6 storyboard).
      let bands = ''
      for (let r = 0; r < 7; r++) {
        bands += `<rect x="78" y="${112 + r * 20}" width="44" height="10" rx="2" fill="#8FA7C2"/>`
      }
      return `<svg viewBox="0 0 200 270" width="${Math.round(W * 0.78)}" aria-hidden="true">
  <rect x="70" y="100" width="60" height="160" fill="#C9D6E3"/>
  <rect x="46" y="200" width="24" height="60" fill="#B7C7D8"/>
  <rect x="130" y="188" width="28" height="72" fill="#B7C7D8"/>
  <rect x="58" y="72" width="84" height="30" rx="6" fill="#DAE4EE"/>
  <rect x="66" y="78" width="68" height="12" rx="4" fill="#7E97B5"/>
  <rect x="88" y="40" width="24" height="34" fill="#C9D6E3"/>
  <rect x="96" y="14" width="8" height="28" fill="#9FB3C8"/>
  ${bands}
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
    case 'jeep':
      return `<svg viewBox="0 0 260 150" width="${Math.round(W * 0.72)}" aria-hidden="true">
  <rect x="14" y="52" width="232" height="58" rx="14" fill="#3A3A3A"/>
  <rect x="40" y="26" width="150" height="40" rx="10" fill="#3A3A3A"/>
  <rect x="52" y="34" width="42" height="26" rx="5" fill="#B9C6D2"/>
  <rect x="102" y="34" width="42" height="26" rx="5" fill="#B9C6D2"/>
  <rect x="150" y="34" width="30" height="26" rx="5" fill="#B9C6D2"/>
  <rect x="222" y="44" width="16" height="34" rx="4" fill="#2B2B2B"/>
  <circle cx="70" cy="112" r="26" fill="#1E1E1E"/>
  <circle cx="70" cy="112" r="12" fill="#CFCFCF"/>
  <circle cx="192" cy="112" r="26" fill="#1E1E1E"/>
  <circle cx="192" cy="112" r="12" fill="#CFCFCF"/>
</svg>`
    case 'facade':
      return `<svg viewBox="0 0 220 260" width="${Math.round(W * 0.8)}" aria-hidden="true">
  <path d="M20 60 L150 20 L150 260 L20 260 Z" fill="#F08A7E"/>
  <path d="M150 20 L200 44 L200 260 L150 260 Z" fill="#E06A5C"/>
  <rect x="52" y="78" width="52" height="64" rx="4" fill="#E8542F"/>
  <rect x="62" y="88" width="32" height="44" fill="#3A241F"/>
  <rect x="52" y="170" width="52" height="64" rx="4" fill="#E8542F"/>
  <rect x="62" y="180" width="32" height="44" fill="#3A241F"/>
</svg>`
    case 'docpencil':
      return `<svg viewBox="0 0 220 220" width="${Math.round(W * 0.78)}" aria-hidden="true">
  <rect x="58" y="18" width="120" height="150" rx="8" fill="#F2E3B8" transform="rotate(8 118 93)"/>
  <rect x="40" y="30" width="130" height="164" rx="8" fill="#FFFFFF" stroke="#D8D2C4" stroke-width="3"/>
  <rect x="56" y="52" width="18" height="16" rx="3" fill="#6FBF6F"/>
  <rect x="82" y="54" width="72" height="10" rx="5" fill="#B9C0CC"/>
  <rect x="56" y="86" width="18" height="16" rx="3" fill="#E06A5C"/>
  <rect x="82" y="88" width="72" height="10" rx="5" fill="#B9C0CC"/>
  <rect x="56" y="120" width="18" height="16" rx="3" fill="#E8C94A"/>
  <rect x="82" y="122" width="72" height="10" rx="5" fill="#B9C0CC"/>
  <g transform="rotate(38 170 150)">
    <rect x="158" y="86" width="22" height="106" rx="4" fill="#E8B14A"/>
    <polygon points="158,192 180,192 169,216" fill="#E3C6A0"/>
    <polygon points="164,205 174,205 169,216" fill="#3A3A3A"/>
    <rect x="158" y="78" width="22" height="12" fill="#D96A6A"/>
  </g>
</svg>`
    case 'checkcircle':
      return `<svg viewBox="0 0 240 240" width="${Math.round(W * 0.82)}" aria-hidden="true">
  <ellipse cx="120" cy="122" rx="96" ry="92" fill="none" stroke="#101010" stroke-width="12" transform="rotate(-6 120 122)" stroke-linecap="round"/>
  <path d="M72 126 l34 36 62 -84" stroke="#3FA35C" stroke-width="20" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
    case 'branch':
      return `<svg viewBox="0 0 220 240" width="${Math.round(W * 0.72)}" aria-hidden="true">
  <g stroke="#2E8C8C" stroke-width="34" stroke-linecap="round" fill="none">
    <path d="M60 220 L150 60"/>
    <path d="M116 122 L60 84"/>
    <path d="M136 88 L182 96"/>
  </g>
  <g stroke="#EAD46A" stroke-width="3" fill="none" opacity="0.7">
    <path d="M70 206 L144 74"/>
    <path d="M112 116 L76 92"/>
  </g>
</svg>`
    case 'roof':
      return `<svg viewBox="0 0 240 200" width="${W}" aria-hidden="true">
  <polygon points="120,30 232,196 8,196" fill="#A9603A"/>
  <g stroke="#7E4527" stroke-width="5">
    <line x1="76" y1="120" x2="164" y2="120"/>
    <line x1="52" y1="158" x2="188" y2="158"/>
  </g>
  <rect x="152" y="56" width="24" height="52" fill="#7E4527"/>
  <circle cx="164" cy="40" r="12" fill="#EFEFEF"/>
  <circle cx="176" cy="26" r="9" fill="#F7F7F7"/>
</svg>`
    case 'magnifier':
      return `<svg viewBox="0 0 220 240" width="${Math.round(W * 0.7)}" aria-hidden="true">
  <circle cx="96" cy="92" r="64" fill="#CDE6F2" stroke="#7FA8BC" stroke-width="10"/>
  <path d="M60 66 a44 44 0 0 1 40 -18" stroke="#FFFFFF" stroke-width="10" fill="none" stroke-linecap="round"/>
  <rect x="128" y="140" width="34" height="86" rx="14" fill="#3E4550" transform="rotate(-38 145 183)"/>
</svg>`
    case 'handshake':
      return `<svg viewBox="0 0 280 180" width="${W}" aria-hidden="true">
  <path d="M8 58 L84 40 L108 96 L60 132 L8 118 Z" fill="#2F5D8A"/>
  <path d="M272 58 L196 40 L172 96 L220 132 L272 118 Z" fill="#3E77AC"/>
  <path d="M84 62 q28 -14 46 4 l32 30 q10 10 0 20 q-10 10 -20 0 l-8 -8 q-8 12 -20 4 l-10 -8 q-8 12 -20 2 l-18 -18 q-10 -14 18 -26" fill="#E8B48E" stroke="#3A2A1E" stroke-width="6" stroke-linejoin="round"/>
  <path d="M196 62 q-28 -16 -48 2 l-20 18" fill="none" stroke="#3A2A1E" stroke-width="6" stroke-linecap="round"/>
</svg>`
  }
}

/**
 * Outro arrow with a DRAW-ON reveal: the shaft/curve stroke writes itself
 * from its start (stroke-dash animation), then the head lands — "starting,
 * curving, pointing, stop". After the draw, the idle bob keeps it alive
 * until the voice ends. Delays are absolute (seconds into the card).
 */
/**
 * Every arrow is ONE single shape — the head is part of the same path (or
 * one filled polygon), so it can NEVER render detached or misaligned. The
 * stroke arrows still draw themselves (the dash animation runs through the
 * curve first, then the head barbs, in one continuous reveal); the block
 * arrow pops in whole.
 */
function arrowSvgStyled(style: ArrowStyle, color: string, heightPx: number, drawDelay = 0): string {
  const H = Math.round(heightPx)
  const d1 = drawDelay.toFixed(2)
  switch (style) {
    case 'block':
      // One solid filled arrow (shaft + head in a single polygon).
      return `<svg viewBox="0 0 120 260" height="${Math.round(H * 0.52)}" aria-hidden="true">
  <polygon class="ahead" style="animation-delay:${d1}s" points="47,8 73,8 73,174 102,174 60,248 18,174 47,174" fill="${color}"/>
</svg>`
    case 'thin':
      return `<svg viewBox="0 0 100 340" height="${Math.round(H * 0.75)}" aria-hidden="true">
  <path class="adraw" style="animation-delay:${d1}s" d="M50 6 L50 322 M16 266 L50 330 L84 266" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`
    case 'slim':
      // Thin shaft + SOLID filled triangular head, one polygon (Set-2 design).
      return `<svg viewBox="0 0 240 520" height="${H}" aria-hidden="true">
  <polygon class="ahead" style="animation-delay:${d1}s" points="108,10 132,10 132,360 230,360 120,510 10,360 108,360" fill="${color}"/>
</svg>`
    case 'curved':
      // Long sweeping curve; head barbs computed from the curve-end tangent
      // (tip 46,232) so the point always caps the stroke exactly.
      return `<svg viewBox="0 0 170 320" height="${H}" aria-hidden="true">
  <path class="adraw" style="animation-delay:${d1}s" d="M126 12 q34 80 -8 158 q-26 48 -72 62 M74 196 L46 232 L90 246" stroke="${color}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
  }
}

const BELL = (fill: string, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" aria-hidden="true"><path d="M12 22a2.6 2.6 0 0 0 2.55-2.1h-5.1A2.6 2.6 0 0 0 12 22Zm7.3-5.2-1.7-1.75V10.9a5.7 5.7 0 0 0-4.2-5.5V4.7a1.4 1.4 0 0 0-2.8 0v.7a5.7 5.7 0 0 0-4.2 5.5v4.15L4.7 16.8A1 1 0 0 0 5.45 18.5h13.1a1 1 0 0 0 .75-1.7Z"/></svg>`

function pillHtml(set: StorySet, pulseDelay: number, fontPx?: number): string {
  const d = pulseDelay.toFixed(2)
  const size = fontPx ? `padding:${Math.round(fontPx * 0.42)}px ${Math.round(fontPx * 1.0)}px;` : ''
  const labelSize = fontPx ? ` style="font-size:${fontPx}px"` : ''
  switch (set.pill) {
    case 'light':
      return `<div class="sub sub-light" style="${size}animation-delay:${d}s"><span class="sub-label"${labelSize}>Subscribe</span></div>`
    case 'dark':
      return `<div class="sub sub-dark" style="${size}animation-delay:${d}s"><span class="sub-label"${labelSize}>SUBSCRIBE</span><span class="sub-bell">${BELL('#101010', 30)}</span></div>`
    case 'outline':
      return `<div class="sub sub-outline" style="${size}animation-delay:${d}s"><span class="sub-label"${labelSize}>SUBSCRIBE</span>${BELL(set.ink, 34)}</div>`
    case 'subscribed':
      return `<div class="sub sub-light" style="${size}animation-delay:${d}s">${BELL('#101010', 32)}<span class="sub-label"${labelSize}>Subscribed</span><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#101010" stroke-width="3" aria-hidden="true"><path d="M5 9 L12 16 L19 9"/></svg></div>`
  }
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
  /** for image sets: resolved hrefs per hero slot (e.g. "assets/intro1_hero.png") */
  images?: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>>
  /**
   * Full-frame 1080×1920 design backgrounds (the storyboard WITHOUT texts),
   * one per card. When a card has a backdrop, its hero slot is skipped (the
   * imagery is baked in), the frame gets a slow cinematic drift ("Ken
   * Burns") so the still feels alive, and only the text/badge/CTA layers
   * animate on top. Placement fidelity is perfect by construction.
   */
  backdrops?: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>>
}

function textSizeFor(text: string): number {
  const len = text.length
  return len <= 20 ? 96 : len <= 32 ? 84 : len <= 48 ? 70 : 60
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
  const ctaImgDelay = Math.min(s2.last + 0.3, Math.max(s2From, D - 1.55))
  const pillDelay = Math.min(s2.last + 0.45, Math.max(s2From, D - 1.25))
  const arrowDelay = Math.min(pillDelay + 0.35, Math.max(s2From, D - 0.9))
  const pulseDelay = Math.min(pillDelay + 0.7, D - 0.4)
  const bobDelay = Math.min(arrowDelay + 0.6, D - 0.4)

  const capsCss = set.caps ? 'text-transform:uppercase;' : ''
  const italicCss = set.italic ? 'font-style:italic;' : ''
  const spacedCss = set.spaced ? 'letter-spacing:3px;' : ''
  const badgeSpacedCss = set.badge.spaced ? 'letter-spacing:4px;text-transform:uppercase;' : 'letter-spacing:2px;'
  const underline2Css = set.underline2
    ? '.sc2 .txt{text-decoration:underline;text-decoration-thickness:6px;text-underline-offset:12px}'
    : ''

  // Oversized storyboard badges: per-card badgeFontPx scales the pill's font,
  // padding and radius together (the badge only appears on intro scene 1).
  const badgeFontPx = set.layouts?.intro1?.badgeFontPx
  const badgeSizeCss = badgeFontPx
    ? `font-size:${badgeFontPx}px;padding:${Math.round(badgeFontPx * 0.3)}px ${Math.round(badgeFontPx * 0.5)}px;border-radius:${Math.round(badgeFontPx * 0.44)}px;`
    : ''
  const badgeAlignCss = set.layouts?.intro1?.badgeAlign === 'center' ? 'align-self:center;' : ''
  const badgeHtml =
    spec.kind === 'intro' && spec.badge
      ? `<div class="badge" style="${badgeSizeCss}${badgeAlignCss}animation-delay:${badgeDelay.toFixed(2)}s">${esc(spec.badge)}</div>`
      : ''

  // Per-card layouts: the set's storyboard-tuned overrides on top of the
  // generic defaults. Heroes use the uploaded PNG when present, else the
  // code-drawn fallback, placed exactly where the layout anchors them —
  // including bleeds off the frame edges (#stage clips them).
  const layoutFor = (card: CardKey): CardLayout => set.layouts?.[card] ?? DEFAULT_CARD_LAYOUTS[card]
  const heroFor = (slot: 'intro1' | 'intro2' | 'outro1', box: HeroLayout): string => {
    const href = spec.images?.[slot]
    if (!href) return assetSvg(set.assets[slot], Math.round(Math.min(box.w ?? box.h, box.h) * 0.95))
    if (box.fit === 'height') {
      // Design-exact: height locked to the measured design, width follows the
      // PNG, the pinned edge sits at the design position, the far side clips.
      return `<img src="${href}" alt="" style="height:${box.h}px;width:auto;display:block"/>`
    }
    // Box mode: contain inside the slot, pushed toward the bleeding edge so
    // the cut side (arm/sleeve) touches the frame edge like the storyboard.
    const justify = box.x === 'right-bleed' ? 'flex-end' : box.x === 'left-bleed' ? 'flex-start' : 'center'
    return `<div class="imgslot" style="width:${box.w}px;height:${box.h}px;justify-content:${justify}"><img src="${href}" alt=""/></div>`
  }
  const heroAbs = (slot: 'intro1' | 'intro2' | 'outro1', delay: number): string => {
    const box = layoutFor(slot).hero
    if (!box) return ''
    const xCss =
      box.left !== undefined
        ? `left:${box.left}px`
        : box.right !== undefined
          ? `right:${box.right}px`
          : box.x === 'left-bleed'
            ? `left:${-(box.bleed ?? 120)}px`
            : box.x === 'right-bleed'
              ? `right:${-(box.bleed ?? 120)}px`
              : 'left:50%;transform:translateX(-50%)'
    const yCss = box.top !== undefined ? `top:${box.top}px` : `bottom:${box.bottom ?? 0}px`
    return `<div class="heroA" style="${xCss};${yCss}"><div class="pop" style="animation-delay:${delay.toFixed(2)}s"><div class="float" style="animation-delay:${(delay + 0.8).toFixed(2)}s">${heroFor(slot, box)}</div></div></div>`
  }

  const card1Key: CardKey = spec.kind === 'intro' ? 'intro1' : 'outro1'
  const card2Key: CardKey = spec.kind === 'intro' ? 'intro2' : 'outro2'
  const bg1 = spec.backdrops?.[card1Key]
  const bg2 = spec.backdrops?.[card2Key]
  // A card with a full-frame backdrop needs no hero — the imagery is baked in.
  const hero1Abs = bg1 ? '' : heroAbs(spec.kind === 'intro' ? 'intro1' : 'outro1', hero1Delay)
  const hero2Html = spec.kind === 'intro' && !bg2 ? heroAbs('intro2', hero2Delay) : ''
  // Backdrops live directly under #stage (full frame, outside the safe area),
  // swap in sync with the scenes (fade), and drift slowly so the still image
  // feels alive: scene 1 zooms in gently, scene 2 settles back.
  const backdropHtml =
    (bg1
      ? `<div class="bgwrap bgsc1" style="animation-delay:${exitDelay.toFixed(2)}s"><img class="bgimg" src="${bg1}" alt=""/></div>`
      : '') +
    (bg2
      ? `<div class="bgwrap bgsc2" style="animation-delay:${tSplit.toFixed(2)}s"><img class="bgimg drift2" src="${bg2}" alt=""/></div>`
      : '')

  // Scene wrapper styles: per-card top padding + text alignment.
  const card1: CardKey = spec.kind === 'intro' ? 'intro1' : 'outro1'
  const card2: CardKey = spec.kind === 'intro' ? 'intro2' : 'outro2'
  const sceneStyle = (card: CardKey): string => {
    const l = layoutFor(card)
    const a = l.textAlign ?? set.align
    const alignCssCard =
      a === 'left'
        ? 'text-align:left;align-items:flex-start;'
        : a === 'right'
          ? 'text-align:right;align-items:flex-end;'
          : 'text-align:center;align-items:center;'
    return `padding-top:${l.padTop}px;${l.padLeft ? `padding-left:${l.padLeft}px;` : ''}${alignCssCard}`
  }

  // Outro scene 2: optional small hero above the pill (set 1's jeep) — the
  // uploaded outro2 PNG when present, else the coded asset if the set has one.
  const ctaImgInner = spec.images?.outro2
    ? `<div class="imgslot" style="width:440px;height:320px"><img src="${spec.images.outro2}" alt=""/></div>`
    : set.outro2Asset
      ? assetSvg(set.outro2Asset, 380)
      : ''
  const ctaImgHtml = spec.subscribe && ctaImgInner
    ? `<div class="cta-img pop" style="animation-delay:${ctaImgDelay.toFixed(2)}s">${ctaImgInner}</div>`
    : ''
  // CROP-PROOF ARROW: the CTA stack is fully system-authored, so compute the
  // vertical space left inside the safe area and size the arrow to fit it
  // EXACTLY. Long CTA text ⇒ shorter arrow; short text ⇒ full-length arrow.
  // Text height uses a conservative wrap estimate (0.55em avg char width),
  // so the arrow can only ever err SMALLER — cropping is impossible.
  const SAFE_H = 1380 // 1920 − 160 top − 380 caption margin
  const l2cta = layoutFor(card2)
  const font2 = l2cta.fontPx ? effectiveFontPx(l2cta.fontPx, spec.scene2, l2cta.fontBaseChars) : textSizeFor(spec.scene2)
  const estLines = Math.max(1, Math.ceil((spec.scene2.length * font2 * 0.55) / 960))
  const textBlockH = 60 + estLines * font2 * 1.2 // margin-top + wrapped lines
  const ctaImgH = spec.images?.outro2 ? 320 + 26 : set.outro2Asset ? 170 + 26 : 0
  const pillH = 78
  const chrome = 44 + ctaImgH + 30 + pillH + 44 + 30 + 24 // scene gaps, cta margins, bob travel
  const arrowH = Math.round(Math.min(545, Math.max(260, SAFE_H - l2cta.padTop - textBlockH - chrome)))
  // Design-measured overrides: absolute pill/arrow positions and an exact
  // arrow height beat the flow-computed fit (the svg height arg compensates
  // the per-style render factor so layout.arrowH is the TRUE on-screen height).
  const arrowHFinal = l2cta.arrowH ?? arrowH
  const arrowHeightArg =
    set.arrowStyle === 'block' ? arrowHFinal / 0.52 : set.arrowStyle === 'thin' ? arrowHFinal / 0.75 : arrowHFinal
  const absCenter = 'position:absolute;left:0;right:0;display:flex;justify-content:center;margin-top:0;'
  const pillPosCss = l2cta.pillTop !== undefined ? `${absCenter}top:${l2cta.pillTop}px;` : ''
  const arrowPosCss = l2cta.arrowTop !== undefined ? `${absCenter}top:${l2cta.arrowTop}px;` : ''
  const ctaHtml = spec.subscribe
    ? `${ctaImgHtml}
      <div class="cta-pop" style="${pillPosCss}animation-delay:${pillDelay.toFixed(2)}s">${pillHtml(set, pulseDelay, l2cta.pillFontPx)}</div>
      <div class="arrow-pop" style="${arrowPosCss}animation-delay:${arrowDelay.toFixed(2)}s">
        <div class="bob" style="animation-delay:${bobDelay.toFixed(2)}s">${arrowSvgStyled(set.arrowStyle, set.arrowColor, arrowHeightArg, arrowDelay + 0.1)}</div>
      </div>`
    : ''

  const fontParam = set.font.trim().replace(/\s+/g, '+')
  const weightList = set.weights.split(';')
  const fontAxis = set.italic
    ? `ital,wght@${weightList.map((w) => `0,${w}`).join(';')};${weightList.map((w) => `1,${w}`).join(';')}`
    : `wght@${set.weights}`
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:${fontAxis}&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${set.bg};font-family:'${set.font}',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;box-sizing:border-box}
  .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-start;gap:44px;box-sizing:border-box}
  .sc1{animation:scOut .35s ease-in both;animation-delay:${exitDelay.toFixed(2)}s;animation-iteration-count:1}
  .sc2{opacity:0;animation:scIn .35s ease-out both;animation-delay:${tSplit.toFixed(2)}s;animation-iteration-count:1}
  .badge{display:inline-block;white-space:nowrap;background:${set.badge.bg};color:${set.badge.ink};font-weight:800;font-size:34px;${badgeSpacedCss}
         padding:12px 28px;border-radius:14px;margin-top:26px;align-self:flex-start;opacity:0;animation:drop .45s cubic-bezier(.2,.8,.3,1.15) both;animation-iteration-count:1}
  .txt{color:${set.ink};font-weight:900;${capsCss}${italicCss}${spacedCss}line-height:1.16;max-width:100%;
       overflow-wrap:normal;word-break:keep-all;margin-top:18px}
  ${underline2Css}
  .w{display:inline-block;opacity:0;animation:wIn .38s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  .bgwrap{position:absolute;inset:0;overflow:hidden}
  .bgimg{width:1080px;height:1920px;object-fit:cover;animation:drift1 1.9s ease-in-out infinite}
  .drift2{animation:drift2 2.1s ease-in-out infinite}
  .bgsc1{animation:bgOut .35s ease-in both;animation-iteration-count:1}
  .bgsc2{opacity:0;animation:bgIn .35s ease-out both;animation-iteration-count:1}
  .heroA{position:absolute;left:50%;transform:translateX(-50%)}
  .heroA .pop{opacity:0}
  .imgslot{display:flex;align-items:center;justify-content:center}
  .imgslot img{max-width:100%;max-height:100%;display:block}
  .pop{animation:pop .55s cubic-bezier(.2,.85,.3,1.25) both;animation-iteration-count:1}
  .float{animation:float 3.2s ease-in-out infinite}
  .cta-img{align-self:center;margin-top:26px;opacity:0}
  .cta-pop{align-self:center;margin-top:30px;opacity:0;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) both;animation-iteration-count:1}
  .sub{display:inline-flex;align-items:center;gap:16px;border-radius:999px;animation:pulse 2.4s ease-in-out infinite}
  .sub-light{background:#FFFFFF;padding:16px 40px}
  .sub-light .sub-label{color:#101010}
  .sub-dark{background:#101010;padding:14px 18px 14px 32px}
  .sub-dark .sub-label{color:#FFFFFF}
  .sub-dark .sub-bell{width:56px;height:56px;border-radius:50%;background:#FFFFFF;display:flex;align-items:center;justify-content:center}
  .sub-outline{background:transparent;border:4px solid ${set.ink};padding:12px 30px}
  .sub-outline .sub-label{color:${set.ink}}
  .sub-label{font-weight:800;font-size:38px;letter-spacing:1px;font-style:normal}
  .arrow-pop{align-self:center;margin-top:30px;opacity:0;animation:wIn .5s ease-out both;animation-iteration-count:1}
  .adraw{stroke-dasharray:520;stroke-dashoffset:520;animation:adraw .8s ease-in-out both;animation-iteration-count:1}
  .ahead{opacity:0;animation:ahead .22s ease-out both;animation-iteration-count:1}
  .bob{animation:bob 1.6s ease-in-out infinite}
  @keyframes wIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
  @keyframes drop{from{opacity:0;transform:translateY(-26px)}to{opacity:1;transform:none}}
  @keyframes pop{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}
  @keyframes scOut{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-70px)}}
  @keyframes scIn{from{opacity:0;transform:translateX(70px)}to{opacity:1;transform:none}}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(12px)}}
  @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(12px)}}
  @keyframes adraw{to{stroke-dashoffset:0}}
  @keyframes ahead{from{opacity:0}to{opacity:1}}
  /* Camera-jitter: VISIBLE rapid x/y trembling at small amplitude (±7px,
     ~1.1s/1.3s per cycle through 8 waypoints ≈ 60-90px/s of on-screen
     velocity — clearly alive, never a large move). A light pulsing blur
     sells the motion. scale(1.03) overscans ~32px so the travel never
     exposes frame edges. Different waypoints + period per scene. */
  @keyframes drift1{
    0%,100%{transform:scale(1.03) translate(0,0);filter:blur(0.25px)}
    12%{transform:scale(1.03) translate(-7px,5px);filter:blur(0.55px)}
    25%{transform:scale(1.03) translate(6px,-4px);filter:blur(0.4px)}
    37%{transform:scale(1.03) translate(-4px,-7px);filter:blur(0.6px)}
    50%{transform:scale(1.03) translate(7px,6px);filter:blur(0.35px)}
    62%{transform:scale(1.03) translate(-6px,2px);filter:blur(0.55px)}
    75%{transform:scale(1.03) translate(3px,-6px);filter:blur(0.4px)}
    87%{transform:scale(1.03) translate(-5px,7px);filter:blur(0.6px)}
  }
  @keyframes drift2{
    0%,100%{transform:scale(1.03) translate(0,0);filter:blur(0.25px)}
    13%{transform:scale(1.03) translate(6px,6px);filter:blur(0.55px)}
    27%{transform:scale(1.03) translate(-7px,3px);filter:blur(0.4px)}
    40%{transform:scale(1.03) translate(5px,-6px);filter:blur(0.6px)}
    53%{transform:scale(1.03) translate(-4px,7px);filter:blur(0.35px)}
    66%{transform:scale(1.03) translate(7px,-3px);filter:blur(0.55px)}
    79%{transform:scale(1.03) translate(-6px,-5px);filter:blur(0.4px)}
    90%{transform:scale(1.03) translate(4px,5px);filter:blur(0.6px)}
  }
  @keyframes bgOut{from{opacity:1}to{opacity:0}}
  @keyframes bgIn{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${D.toFixed(3)}">
  ${backdropHtml}
  <div class="safe">
    <div class="scene sc1" style="${sceneStyle(card1)}">
      ${badgeHtml}
      <div class="txt" style="font-size:${layoutFor(card1).fontPx ? effectiveFontPx(layoutFor(card1).fontPx!, spec.scene1, layoutFor(card1).fontBaseChars) : textSizeFor(spec.scene1)}px${layoutFor(card1).txtTop !== undefined ? `;position:absolute;top:${layoutFor(card1).txtTop}px;left:${layoutFor(card1).padLeft ?? 0}px;right:0;margin-top:0` : ''}">${s1.html}</div>
      ${hero1Abs}
    </div>
    <div class="scene sc2" style="${sceneStyle(card2)}">
      <div class="txt" style="font-size:${layoutFor(card2).fontPx ? effectiveFontPx(layoutFor(card2).fontPx!, spec.scene2, layoutFor(card2).fontBaseChars) : textSizeFor(spec.scene2)}px;margin-top:60px${layoutFor(card2).txtTop !== undefined ? `;position:absolute;top:${layoutFor(card2).txtTop}px;left:${layoutFor(card2).padLeft ?? 0}px;right:0;margin-top:0` : ''}">${s2.html}</div>
      ${spec.kind === 'intro' ? hero2Html : ctaHtml}
    </div>
  </div>
</div>
</body>
</html>`
}
