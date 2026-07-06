// =====================================================================
// STORY TEMPLATE CARDS — 2-scene intro / 2-scene outro (storyboard style)
// =====================================================================
// STORY_SETS below is the State Exams Prep template pack (10 sets). Each
// CHANNEL has its OWN pack of 10 sets (own layouts/designs); see
// STORY_SET_PACKS + setsForChannel + templateAssetDir near the bottom.
// PRODUCTION MODEL, settled
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

import fs from 'node:fs'
import path from 'node:path'
import { NINE_SIXTEEN } from '@shared/zones'
import { getStoragePaths } from '../settings'

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
export type PillStyle = 'light' | 'dark' | 'outline' | 'subscribed' | 'brand'

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
  badge: { bg: string; ink: string; spaced?: boolean; italic?: boolean }
  arrowStyle: ArrowStyle
  arrowColor: string
  pill: PillStyle
  /** brand-pill fill when it differs from the badge colour (e.g. blue badge, red pill) */
  pillColor?: string
  /** per-word scene-text highlight colour (words listed in the script's `highlight:` get it) */
  hlColor?: string
  /** italicise highlighted words */
  hlItalic?: boolean
  /** scene-text font weight (default 900) — for sets whose body copy is lighter */
  textWeight?: number
  /** hollow/outlined scene text: the stroke colour (fill becomes transparent) */
  textOutline?: string
  /** suppress the drawn subscribe pill (design supplies its own CTA visual); the arrow still draws */
  noPill?: boolean
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
  /** per-card text colour override (default: the set's ink) — for cards whose
   *  backdrop needs a different contrast (e.g. white text on a dark shape) */
  ink?: string
  /** badge chip alignment on intro scene 1 (default left) */
  badgeAlign?: 'left' | 'center' | 'right'
  /** absolute badge-chip top (px, safe-relative) — for designs where the exam-name
   *  chip sits away from the scene top (e.g. on a prop). Default: flows above scene-1 text. */
  badgeTop?: number
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
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-4 design frames (backdrop-first).
    // Chunky Baloo caps, centered. Yellow badge centered at abs y≈167
    // (font 96); intro1 title abs y≈399 @140/23ch; intro2 abs y≈167
    // @138/29ch; outro1 abs y≈177 @138/27ch. Outro2 is pill-FIRST:
    // "Subscribed" pill abs y≈197 (font 88), text abs y≈515 @132/43ch,
    // big gray curved arrow abs y≈1242 (design height 640 — the safe-zone
    // clamp renders what fits above the caption zone).
    layouts: {
      intro1: {
        padTop: 7,
        badgeFontPx: 96,
        badgeAlign: 'center',
        txtTop: 239,
        fontPx: 140,
        fontBaseChars: 23,
        hero: { w: 900, h: 900, x: 'center', top: 840 }
      },
      intro2: {
        padTop: 0,
        txtTop: 7,
        fontPx: 138,
        fontBaseChars: 29,
        hero: { w: 620, h: 900, x: 'center', top: 770 }
      },
      outro1: {
        padTop: 0,
        txtTop: 17,
        fontPx: 138,
        fontBaseChars: 27,
        hero: { w: 900, h: 640, x: 'center', top: 1090 }
      },
      outro2: {
        padTop: 0,
        txtTop: 355,
        fontPx: 132,
        fontBaseChars: 43,
        pillTop: 37,
        pillFontPx: 88,
        arrowTop: 1082,
        arrowH: 640
      }
    }
  },
  {
    id: 5,
    name: 'slate',
    bg: '#B4CBE3',
    ink: '#101010',
    font: 'Poppins',
    weights: '600;700;800',
    caps: false,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#9FD8CE', ink: '#17342F' },
    arrowStyle: 'curved',
    arrowColor: '#101010',
    pill: 'outline',
    underline2: true,
    assets: { intro1: 'magnifier', intro2: 'handshake', outro1: 'clipboard' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-5 design frames (backdrop-first).
    // Left-aligned Poppins on light periwinkle; mint badge centered at the
    // safe top (font 96). intro1 title abs y≈368 @165/20ch (padLeft 35);
    // intro2 UNDERLINED text at the safe top @165/34ch; outro1 abs y≈247
    // @138/29ch. Outro2 centered: text abs y≈227 @108/41ch, outlined
    // SUBSCRIBE pill abs y≈863 (font 72), black curved arrow abs y≈1277
    // (design 500 — safe-zone clamp renders what fits).
    layouts: {
      intro1: {
        padTop: 0,
        badgeFontPx: 96,
        badgeAlign: 'center',
        txtTop: 208,
        padLeft: 35,
        fontPx: 165,
        fontBaseChars: 20,
        hero: { w: 700, h: 720, x: 'center', top: 940 }
      },
      intro2: {
        padTop: 0,
        txtTop: 0,
        padLeft: 5,
        fontPx: 165,
        fontBaseChars: 34,
        hero: { w: 1040, h: 820, x: 'center', top: 890 }
      },
      outro1: {
        padTop: 0,
        txtTop: 87,
        padLeft: 35,
        fontPx: 138,
        fontBaseChars: 29,
        hero: { w: 640, h: 900, x: 'center', top: 680 }
      },
      outro2: {
        padTop: 0,
        txtTop: 67,
        textAlign: 'center',
        fontPx: 108,
        fontBaseChars: 41,
        pillTop: 703,
        pillFontPx: 72,
        arrowTop: 1117,
        arrowH: 500
      }
    }
  },
  {
    id: 6,
    name: 'navy',
    bg: '#16337B',
    ink: '#FFFFFF',
    font: 'Archivo',
    weights: '700;800;900',
    caps: true,
    italic: true,
    spaced: true,
    align: 'left',
    badge: { bg: '#101010', ink: '#FFFFFF', spaced: true },
    arrowStyle: 'block',
    arrowColor: '#B7CFE9',
    pill: 'subscribed',
    assets: { intro1: 'tower', intro2: 'skyscraper', outro1: 'house' },
    assetMode: 'image',
    svgFallbackOk: true,
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-6 design frames (backdrop-first).
    // Italic spaced caps on deep navy, left-aligned at padLeft 25 (intro2 at
    // 70). Black italic badge at the safe top (font 72); intro1 title abs
    // y≈333 @138/24ch; intro2 abs y≈268 @112/26ch; outro1 abs y≈293
    // @118/31ch. Outro2 centered: text abs y≈207 @100/43ch, "Subscribed"
    // pill abs y≈853 (font 72), light-blue block arrow abs y≈1282 (design
    // 573 — safe-zone clamp renders what fits above the caption zone).
    layouts: {
      intro1: {
        padTop: 0,
        padLeft: 25,
        badgeFontPx: 72,
        txtTop: 173,
        fontPx: 138,
        fontBaseChars: 24,
        hero: { w: 560, h: 950, x: 'center', top: 830 }
      },
      intro2: {
        padTop: 0,
        padLeft: 70,
        txtTop: 108,
        fontPx: 112,
        fontBaseChars: 26,
        hero: { w: 640, h: 990, x: 'center', top: 790 }
      },
      outro1: {
        padTop: 0,
        padLeft: 25,
        txtTop: 133,
        fontPx: 118,
        fontBaseChars: 31,
        hero: { w: 900, h: 850, x: 'center', top: 890 }
      },
      outro2: {
        padTop: 0,
        txtTop: 47,
        textAlign: 'center',
        fontPx: 100,
        fontBaseChars: 43,
        pillTop: 693,
        pillFontPx: 72,
        arrowTop: 1122,
        arrowH: 573
      }
    }
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
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-7 design frames (backdrop-first,
    // character illustrations baked into the frames). Centered Poppins on
    // lavender; slim white spaced badge at the safe top (font 58). intro1
    // title abs y≈454 @130/19ch; intro2 abs y≈197 @135/36ch; outro1 abs
    // y≈227 @132/30ch (the design's mid-word wrap is NOT reproduced — we
    // wrap at word boundaries only). Outro2: text abs y≈288 @116/43ch,
    // outlined SUBSCRIBE pill abs y≈898 (font 66), thin arrow abs y≈1302
    // (design 490 — safe-zone clamp renders what fits).
    layouts: {
      intro1: {
        padTop: 0,
        badgeFontPx: 58,
        badgeAlign: 'center',
        txtTop: 294,
        fontPx: 130,
        fontBaseChars: 19,
        hero: { w: 900, h: 900, x: 'center', top: 860 }
      },
      intro2: {
        padTop: 0,
        txtTop: 37,
        fontPx: 135,
        fontBaseChars: 36,
        hero: { w: 980, h: 830, x: 'center', top: 880 }
      },
      outro1: {
        padTop: 0,
        txtTop: 67,
        fontPx: 132,
        fontBaseChars: 30,
        hero: { w: 850, h: 880, x: 'center', top: 850 }
      },
      outro2: {
        padTop: 0,
        txtTop: 128,
        fontPx: 116,
        fontBaseChars: 43,
        pillTop: 738,
        pillFontPx: 66,
        arrowTop: 1142,
        arrowH: 490
      }
    }
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
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-8 design frames (backdrop-first,
    // character illustrations baked in). Archivo caps on warm paper. Slim
    // white spaced badge at the safe top (font 58, centered). intro1 title
    // LEFT abs y≈353 @116/24ch (padLeft 25); intro2 RIGHT-aligned abs y≈227
    // @150/23ch; outro1 centered abs y≈177 @140/31ch. Outro2 centered: text
    // at the safe top @130/43ch, dark SUBSCRIBE pill abs y≈1095 (font 64),
    // RED curved arrow at abs y≈1358 in the design — the safe-zone clamp
    // lifts it to fit fully above the caption zone.
    layouts: {
      intro1: {
        padTop: 0,
        badgeFontPx: 58,
        badgeAlign: 'center',
        txtTop: 193,
        padLeft: 25,
        fontPx: 116,
        fontBaseChars: 24,
        hero: { w: 1000, h: 950, x: 'center', top: 800 }
      },
      intro2: {
        padTop: 0,
        txtTop: 67,
        textAlign: 'right',
        fontPx: 150,
        fontBaseChars: 23,
        hero: { w: 900, h: 850, x: 'center', top: 890 }
      },
      outro1: {
        padTop: 0,
        txtTop: 17,
        textAlign: 'center',
        fontPx: 140,
        fontBaseChars: 31,
        hero: { w: 980, h: 850, x: 'center', top: 880 }
      },
      outro2: {
        padTop: 0,
        txtTop: 0,
        textAlign: 'center',
        fontPx: 120, // was 130 — design-length text grazed the right border
        fontBaseChars: 43,
        pillTop: 935,
        pillFontPx: 64,
        arrowTop: 1198,
        arrowH: 455
      }
    }
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
    arrowStyle: 'thin',
    arrowColor: '#3A2B1F',
    pill: 'subscribed',
    assets: { intro1: 'questions', intro2: 'books', outro1: 'clipboard' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-9 design frames (backdrop-first,
    // characters baked in). Centered chunky Archivo on light blue; slim white
    // spaced badge at the safe top (font 58). intro1 is FLIPPED — character
    // on top, title at the BOTTOM (design abs y≈1312, running into the
    // caption zone; the safe-zone clamp lifts it to fit fully above).
    // intro2 abs y≈207 @126/32ch; outro1 abs y≈303 @142/35ch. Outro2: text
    // abs y≈197 @112/43ch, "Subscribed" pill abs y≈752 (font 76),
    // hand-drawn dark-brown arrow abs y≈1070 (design 520 → clamp fits 446).
    layouts: {
      intro1: {
        padTop: 0,
        badgeFontPx: 58,
        badgeAlign: 'center',
        txtTop: 1152,
        fontPx: 138,
        fontBaseChars: 26,
        hero: { w: 700, h: 800, x: 'center', top: 200 }
      },
      intro2: {
        padTop: 0,
        txtTop: 47,
        fontPx: 126,
        fontBaseChars: 32,
        hero: { w: 1000, h: 900, x: 'center', top: 830 }
      },
      outro1: {
        padTop: 0,
        txtTop: 143,
        fontPx: 142,
        fontBaseChars: 35,
        hero: { w: 700, h: 800, x: 'center', top: 1000 }
      },
      outro2: {
        padTop: 0,
        txtTop: 37,
        fontPx: 112,
        fontBaseChars: 43,
        pillTop: 592,
        pillFontPx: 76,
        arrowTop: 910,
        arrowH: 520
      }
    }
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
    imageSlots: STD_SLOTS,
    // Measured from the exact 1080×1920 Set-10 design frames (backdrop-first,
    // halftone architecture baked in). Centered rounded Quicksand on
    // off-white; slim white spaced badge at the safe top (font 58). intro1
    // title abs y≈444 @145/19ch; intro2 abs y≈273 @160/18ch; outro1 abs
    // y≈207 @138/25ch. Outro2: text abs y≈212 @138/43ch, white Subscribe
    // pill abs y≈974 (font 78), solid black block arrow abs y≈1272 (design
    // 518 — safe-zone clamp renders what fits above the caption zone).
    layouts: {
      intro1: {
        padTop: 0,
        badgeFontPx: 58,
        badgeAlign: 'center',
        txtTop: 284,
        fontPx: 145,
        fontBaseChars: 19,
        hero: { w: 1000, h: 800, x: 'center', top: 940 }
      },
      intro2: {
        padTop: 0,
        txtTop: 113,
        fontPx: 160,
        fontBaseChars: 18,
        hero: { w: 1040, h: 900, x: 'center', top: 880 }
      },
      outro1: {
        padTop: 0,
        txtTop: 47,
        fontPx: 138,
        fontBaseChars: 25,
        hero: { w: 950, h: 900, x: 'center', top: 850 }
      },
      outro2: {
        padTop: 0,
        txtTop: 52,
        fontPx: 138,
        fontBaseChars: 43,
        pillTop: 814,
        pillFontPx: 78,
        arrowTop: 1112,
        arrowH: 518
      }
    }
  }
]

// =====================================================================
// CHANNEL PACKS — every channel has its own 10 sets. Only State Exams Prep
// is measured today; other channels fall back to it as a stand-in (their own
// asset folders are empty, so they render the svg-drawn versions) until their
// design frames arrive and get a measuring pass. Scripts already carry
// `channel:`, so routing is automatic — no per-video wiring.
// =====================================================================

/** Stable folder-safe slug for a channel display name. */
export function channelSlug(channel?: string): string {
  return (channel || 'State Exams Prep')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// OA Guides pack. Black bg, bold Playfair serif, brick-red accent. Set 1 =
// "typewriter": intro1 hook TOP + exam badge on the paper (badgeTop), intro2
// dramatic caps line, outro1 short line beside a wax seal (in the backdrop),
// outro2 CTA + red brand pill + system arrow (the designer omitted the arrow
// in the storyboard — we always draw one). More OA Guides sets are added here
// as their design frames arrive and get measured.
const OA_GUIDES_SETS: StorySet[] = [
  {
    id: 1,
    name: 'oaguides-typewriter',
    bg: '#000000',
    ink: '#FFFFFF',
    font: 'Playfair Display',
    weights: '700;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#D93B0D', ink: '#FFFFFF', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#FFFFFF',
    pill: 'brand',
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Hook near the top; exam-name chip lands on the typewriter paper.
      intro1: {
        padTop: 0,
        txtTop: 120,
        fontPx: 108,
        fontBaseChars: 26,
        textAlign: 'center',
        badgeTop: 730,
        badgeFontPx: 84,
        badgeAlign: 'center'
      },
      // Dramatic centered line ("DON'T BE ONE OF THEM.").
      intro2: { padTop: 0, txtTop: 470, fontPx: 132, fontBaseChars: 22, textAlign: 'center' },
      // Short line beside the wax seal (seal is baked into the backdrop).
      outro1: { padTop: 0, txtTop: 600, fontPx: 140, fontBaseChars: 16, textAlign: 'center' },
      // CTA text on top, red brand pill mid-frame, arrow below it pointing up.
      outro2: {
        padTop: 0,
        txtTop: 180,
        fontPx: 92,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 660,
        pillFontPx: 44,
        arrowTop: 870,
        arrowH: 400
      }
    }
  },
  {
    id: 2,
    name: 'oaguides-thinker',
    bg: '#000000',
    ink: '#FFFFFF',
    font: 'Montserrat',
    weights: '700;800',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#1B7FD6', ink: '#000000', spaced: false, italic: true },
    arrowStyle: 'block',
    arrowColor: '#FFFFFF',
    pill: 'brand',
    pillColor: '#D93B0D',
    hlColor: '#1B7FD6',
    hlItalic: true,
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Blue exam-badge at the top; bold hook below (statue baked into backdrop).
      intro1: {
        padTop: 0,
        txtTop: 270,
        fontPx: 128,
        fontBaseChars: 26,
        textAlign: 'center',
        badgeTop: 20,
        badgeFontPx: 72,
        badgeAlign: 'center'
      },
      intro2: { padTop: 0, txtTop: 150, fontPx: 130, fontBaseChars: 22, textAlign: 'center' },
      outro1: { padTop: 0, txtTop: 150, fontPx: 135, fontBaseChars: 16, textAlign: 'center' },
      // CTA text on top, red brand pill mid-frame, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 120,
        fontPx: 92,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 790,
        pillFontPx: 44,
        arrowTop: 1010,
        arrowH: 300
      }
    }
  },
  {
    id: 3,
    name: 'oaguides-mind',
    bg: '#E8E4DD',
    ink: '#1A1A1A',
    font: 'Fraunces',
    weights: '700;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#1A1A1A', ink: '#FFFFFF', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#1A1A1A',
    pill: 'outline',
    hlColor: '#C0371C',
    hlItalic: false,
    assets: { intro1: 'magnifier', intro2: 'key', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Badge at the top; serif hook ("Hardest concept") in the mid-upper area
      // just above the head silhouette, which sits in the lower half with
      // "simplified." (red) baked into its brain. effectiveFontPx keeps the
      // hook <=2 lines so it always clears the head crown (~safeY 710).
      intro1: {
        padTop: 0,
        txtTop: 350,
        fontPx: 116,
        fontBaseChars: 26,
        textAlign: 'center',
        badgeTop: 30,
        badgeFontPx: 80,
        badgeAlign: 'center'
      },
      intro2: { padTop: 0, txtTop: 220, fontPx: 118, fontBaseChars: 38, textAlign: 'center' },
      // Short line above the megaphone doodle (in the backdrop).
      outro1: { padTop: 0, txtTop: 150, fontPx: 135, fontBaseChars: 16, textAlign: 'center' },
      // CTA text on top, black-outline subscribe pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 120,
        fontPx: 92,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 720,
        pillFontPx: 42,
        arrowTop: 840,
        arrowH: 340
      }
    }
  },
  {
    id: 4,
    name: 'oaguides-blob',
    bg: '#F5D33F',
    ink: '#111111',
    font: 'Poppins',
    weights: '500;800',
    textWeight: 500,
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#9BC4E8', ink: '#111111', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#111111',
    pill: 'subscribed',
    pillColor: '#C8C8C8',
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Revised frame: the red asterisk moved to the BOTTOM, freeing the top —
      // blue exam-badge top-left, big LEFT-aligned hook right below it in the
      // upper area (asterisk baked into the lower backdrop).
      intro1: {
        padTop: 0,
        txtTop: 260,
        fontPx: 130,
        fontBaseChars: 22,
        textAlign: 'left',
        badgeTop: 0,
        badgeFontPx: 72,
        badgeAlign: 'left'
      },
      intro2: { padTop: 0, txtTop: 150, fontPx: 130, fontBaseChars: 16, textAlign: 'center' },
      outro1: { padTop: 0, txtTop: 180, fontPx: 120, fontBaseChars: 20, textAlign: 'center' },
      // CTA text on top, gray "Subscribed" pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 100,
        fontPx: 92,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 820,
        pillFontPx: 46,
        arrowTop: 980,
        arrowH: 300
      }
    }
  },
  {
    id: 5,
    name: 'oaguides-foggy',
    bg: '#E5E1DA',
    ink: '#111111',
    font: 'Archivo',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#5468E8', ink: '#16215E', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#111111',
    pill: 'subscribed',
    pillColor: '#C4C4C4',
    assets: { intro1: 'magnifier', intro2: 'key', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // INVERTED: blob character up top (backdrop); blue exam-badge then hook
      // in the lower half.
      intro1: {
        padTop: 0,
        txtTop: 1010,
        fontPx: 128,
        fontBaseChars: 20,
        textAlign: 'center',
        badgeTop: 810,
        badgeFontPx: 60,
        badgeAlign: 'center'
      },
      // Text top, blob bottom (backdrop).
      intro2: { padTop: 0, txtTop: 120, fontPx: 135, fontBaseChars: 16, textAlign: 'center' },
      outro1: { padTop: 0, txtTop: 150, fontPx: 130, fontBaseChars: 22, textAlign: 'center' },
      // CTA text on top, gray "Subscribed" pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 120,
        fontPx: 96,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 720,
        pillFontPx: 46,
        arrowTop: 890,
        arrowH: 340
      }
    }
  },
  {
    id: 6,
    name: 'oaguides-serif-blue',
    bg: '#8FB4E8',
    ink: '#2C4AA0',
    font: 'Playfair Display',
    weights: '600;800',
    caps: false,
    italic: true,
    spaced: false,
    align: 'center',
    badge: { bg: '#FFFFFF', ink: '#2C4AA0', spaced: false, italic: true },
    arrowStyle: 'block',
    arrowColor: '#1B2160',
    pill: 'subscribed',
    pillColor: '#C4C4C4',
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Redesigned frames: the scalloped shapes are now EMPTY decorative
      // elements at the edges; all text sits on the open blue background (no
      // longer inside a shape). White exam-badge near the top; italic hook
      // in the upper-middle, scallop below it (backdrop).
      intro1: {
        padTop: 0,
        txtTop: 430,
        fontPx: 135,
        fontBaseChars: 26,
        textAlign: 'center',
        badgeTop: 210,
        badgeFontPx: 56,
        badgeAlign: 'center'
      },
      // Empty scallop at top; text below it on blue.
      intro2: { padTop: 0, txtTop: 520, fontPx: 118, fontBaseChars: 28, textAlign: 'center' },
      // White italic text lower-LEFT on blue; navy flower sits top-right (backdrop).
      outro1: { padTop: 0, txtTop: 900, fontPx: 115, fontBaseChars: 20, textAlign: 'left', ink: '#FFFFFF' },
      // Navy CTA text on top, gray "Subscribed" pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 120,
        fontPx: 96,
        fontBaseChars: 42,
        textAlign: 'center',
        ink: '#1B2160',
        pillTop: 800,
        pillFontPx: 44,
        arrowTop: 950,
        arrowH: 280
      }
    }
  },
  {
    id: 7,
    name: 'oaguides-doodle',
    bg: '#F5F4F2',
    ink: '#111111',
    font: 'Nunito',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#C0341B', ink: '#F5EAD9', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#111111',
    pill: 'brand',
    pillColor: '#C0341B',
    assets: { intro1: 'magnifier', intro2: 'key', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Red exam-badge at top; hook LOW (doodles fill the upper backdrop).
      intro1: {
        padTop: 0,
        txtTop: 860,
        fontPx: 128,
        fontBaseChars: 26,
        textAlign: 'center',
        badgeTop: 10,
        badgeFontPx: 66,
        badgeAlign: 'center'
      },
      // Text upper-middle, torn-newspaper scrap in the lower backdrop.
      intro2: { padTop: 0, txtTop: 620, fontPx: 130, fontBaseChars: 20, textAlign: 'center' },
      // Text middle, between the newspaper scrap (top) and doodle arrow (bottom).
      outro1: { padTop: 0, txtTop: 790, fontPx: 120, fontBaseChars: 28, textAlign: 'center' },
      // CTA text on top, red brand pill, system arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 100,
        fontPx: 96,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 790,
        pillFontPx: 44,
        arrowTop: 920,
        arrowH: 340
      }
    }
  },
  {
    id: 8,
    name: 'oaguides-3d',
    bg: '#000000',
    ink: '#FFFFFF',
    textOutline: '#FFFFFF',
    font: 'Nunito',
    weights: '800;900',
    caps: false,
    italic: false,
    spaced: false,
    align: 'left',
    badge: { bg: '#FCD53F', ink: '#111111', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#FFFFFF',
    pill: 'brand',
    pillColor: '#D93B0D',
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Yellow exam-badge top-RIGHT; hollow outlined hook, left-aligned; the
      // pink 3D character sits in the lower backdrop.
      intro1: {
        padTop: 0,
        txtTop: 200,
        fontPx: 128,
        fontBaseChars: 26,
        textAlign: 'left',
        badgeTop: 10,
        badgeFontPx: 60,
        badgeAlign: 'right'
      },
      intro2: { padTop: 0, txtTop: 560, fontPx: 130, fontBaseChars: 16, textAlign: 'left' },
      outro1: { padTop: 0, txtTop: 120, fontPx: 130, fontBaseChars: 16, textAlign: 'left' },
      // CTA text on top; NO pill (design uses a bell+check emoji); arrow only,
      // in the gap above the 3D clapping-hands backdrop.
      outro2: {
        padTop: 0,
        txtTop: 120,
        fontPx: 96,
        fontBaseChars: 42,
        textAlign: 'left',
        pillTop: 820,
        pillFontPx: 44,
        arrowTop: 960,
        arrowH: 280
      }
    }
  },
  {
    id: 9,
    name: 'oaguides-photo',
    bg: '#F2F1EF',
    ink: '#111111',
    font: 'Poppins',
    weights: '700;800',
    textWeight: 800,
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#111111', ink: '#FFFFFF', spaced: false },
    arrowStyle: 'block',
    arrowColor: '#111111',
    pill: 'brand',
    pillColor: '#D93B0D',
    assets: { intro1: 'magnifier', intro2: 'key', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Cut-out road photo fills the LEFT; badge + hook pushed to the right
      // half via padLeft (both centre within the remaining right column).
      intro1: {
        padTop: 0,
        txtTop: 560,
        fontPx: 110,
        fontBaseChars: 22,
        textAlign: 'center',
        padLeft: 380,
        badgeTop: 380,
        badgeFontPx: 54,
        badgeAlign: 'center'
      },
      // Text top-centre, B&W cut-out photo in the lower backdrop.
      intro2: { padTop: 0, txtTop: 150, fontPx: 120, fontBaseChars: 22, textAlign: 'center' },
      outro1: { padTop: 0, txtTop: 150, fontPx: 120, fontBaseChars: 20, textAlign: 'center' },
      // CTA text on top, red brand pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 100,
        fontPx: 96,
        fontBaseChars: 42,
        textAlign: 'center',
        pillTop: 840,
        pillFontPx: 44,
        arrowTop: 970,
        arrowH: 300
      }
    }
  },
  {
    id: 10,
    name: 'oaguides-cat',
    bg: '#000000',
    ink: '#FFFFFF',
    font: 'Poppins',
    weights: '600;700',
    textWeight: 700,
    caps: false,
    italic: false,
    spaced: false,
    align: 'center',
    badge: { bg: '#E5E0D5', ink: '#111111', spaced: false, italic: true },
    arrowStyle: 'block',
    arrowColor: '#FFFFFF',
    pill: 'brand',
    pillColor: '#D93B0D',
    // White highlight + italic = italic EMPHASIS with no colour change (the
    // design italicises the punch phrase, e.g. "get this?", "60 seconds").
    hlColor: '#FFFFFF',
    hlItalic: true,
    assets: { intro1: 'key', intro2: 'magnifier', outro1: 'handshake' },
    assetMode: 'image',
    imageSlots: STD_SLOTS,
    layouts: {
      // Cream exam-badge top-RIGHT; hook right-aligned; suited-cat in the
      // lower backdrop.
      intro1: {
        padTop: 0,
        txtTop: 240,
        fontPx: 118,
        fontBaseChars: 22,
        textAlign: 'right',
        badgeTop: 10,
        badgeFontPx: 54,
        badgeAlign: 'right'
      },
      intro2: { padTop: 0, txtTop: 120, fontPx: 120, fontBaseChars: 22, textAlign: 'center' },
      outro1: { padTop: 0, txtTop: 150, fontPx: 120, fontBaseChars: 20, textAlign: 'left' },
      // CTA text (left), red brand pill, arrow below it.
      outro2: {
        padTop: 0,
        txtTop: 60,
        fontPx: 92,
        fontBaseChars: 42,
        textAlign: 'left',
        pillTop: 720,
        pillFontPx: 44,
        arrowTop: 850,
        arrowH: 300
      }
    }
  }
]

export const STORY_SET_PACKS: Record<string, StorySet[]> = {
  [channelSlug('State Exams Prep')]: STORY_SETS,
  [channelSlug('OA Guides')]: OA_GUIDES_SETS
}

/** The 10 sets for a channel. Un-coded channels fall back to the State Exams
 *  pack so a job still renders (its own folder empty → svg stand-ins). */
export function setsForChannel(channel?: string): StorySet[] {
  return STORY_SET_PACKS[channelSlug(channel)] ?? STORY_SETS
}

/** On-disk folder for one channel's set assets. New uploads live in
 *  template-assets/<channel-slug>/set-<N>/. The original State Exams Prep
 *  uploads predate channel folders and live flat in template-assets/set-<N>/;
 *  keep resolving those so nothing must be re-uploaded. */
export function templateAssetDir(channel: string | undefined, setId: number): string {
  const base = path.join(getStoragePaths().userData, 'template-assets')
  const scoped = path.join(base, channelSlug(channel), `set-${setId}`)
  const hasPng = (dir: string): boolean => {
    try {
      return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.png'))
    } catch {
      return false
    }
  }
  // Prefer the channel-scoped folder once it actually HOLDS PNGs, so an empty
  // scaffolded folder never shadows real assets. State Exams Prep's original
  // uploads live in the flat template-assets/set-N/ folder; keep resolving
  // those until they're moved into state-exams-prep/set-N/.
  if (hasPng(scoped)) return scoped
  if (channelSlug(channel) === channelSlug('State Exams Prep')) {
    const legacy = path.join(base, `set-${setId}`)
    if (hasPng(legacy)) return legacy
  }
  return scoped
}

/**
 * Create the channel-scoped template-asset folders for every coded pack, so the
 * user has a clear, labelled place to drop each set's *_bg.png files. Called on
 * app startup. Empty folders are harmless — templateAssetDir keys off actual
 * PNGs, and State Exams keeps resolving its legacy flat folders until assets are
 * moved in. Adds a README so the folder purpose is obvious in Explorer.
 */
export function ensureTemplateFolders(): void {
  const base = path.join(getStoragePaths().userData, 'template-assets')
  for (const [slug, sets] of Object.entries(STORY_SET_PACKS)) {
    for (const set of sets) {
      try {
        fs.mkdirSync(path.join(base, slug, `set-${set.id}`), { recursive: true })
      } catch {
        // best-effort: a missing folder just means nothing has been uploaded yet
      }
    }
    try {
      const readme = path.join(base, slug, '_PUT_BACKDROPS_HERE.txt')
      if (!fs.existsSync(readme)) {
        fs.writeFileSync(
          readme,
          `Drop each set's four backdrops into its set-N folder:\n` +
            `  set-1/intro1_bg.png  intro2_bg.png  outro1_bg.png  outro2_bg.png\n` +
            `  set-2/ ...\n(exact lowercase filenames)\n`
        )
      }
    } catch {
      // ignore
    }
  }
}

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
export function pickStorySet(
  seed: string,
  override?: number,
  availableImageSets: number[] = [],
  channel?: string
): StorySet {
  const sets = setsForChannel(channel)
  if (override && override >= 1) {
    return sets[(override - 1) % sets.length]
  }
  let pool = sets.filter((s) => availableImageSets.includes(s.id))
  if (pool.length === 0) pool = sets.filter((s) => s.svgFallbackOk)
  if (pool.length === 0) pool = sets
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
    case 'subscribed': {
      const bgc = set.pillColor ? `background:${set.pillColor};` : ''
      return `<div class="sub sub-light" style="${bgc}${size}animation-delay:${d}s">${BELL('#101010', 32)}<span class="sub-label"${labelSize}>Subscribed</span><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#101010" stroke-width="3" aria-hidden="true"><path d="M5 9 L12 16 L19 9"/></svg></div>`
    }
    case 'brand':
      return `<div class="sub sub-brand" style="${size}animation-delay:${d}s"><span class="sub-label"${labelSize}>SUBSCRIBE</span>${BELL('#FFFFFF', 42)}</div>`
  }
}

// ---------------------------------------------------------------------
// Card composition
// ---------------------------------------------------------------------
export interface StoryCardSpec {
  kind: 'intro' | 'outro'
  scene1: string
  scene2: string
  /** exam display name (falls back to channel for old scripts) shown in the badge chip (intro scene 1 only) */
  badge?: string
  subscribe?: boolean
  durationSeconds: number
  set: StorySet
  /** scene-text words to highlight in the set's hlColor (from the script's `highlight:`) */
  highlight?: string[]
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

const normHl = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, '')
function wordSpans(
  text: string,
  from: number,
  to: number,
  hl?: { words: Set<string>; color: string; italic: boolean }
): { html: string; last: number } {
  const words = text.split(/\s+/).filter(Boolean)
  const n = words.length
  const step = n > 1 ? Math.min(0.3, Math.max(0.08, (to - from) / (n - 1))) : 0
  let last = from
  const html = words
    .map((w, i) => {
      const d = Math.min(from + i * step, to)
      last = Math.max(last, d)
      const isHl = hl && hl.words.has(normHl(w))
      const extra = isHl ? `color:${hl!.color};${hl!.italic ? 'font-style:italic;' : ''}` : ''
      return `<span class="w" style="${extra}animation-delay:${d.toFixed(2)}s">${esc(w)}</span>`
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
  const hlOpts = set.hlColor
    ? {
        words: new Set((spec.highlight ?? []).flatMap((h) => h.split(/\s+/)).map(normHl).filter(Boolean)),
        color: set.hlColor,
        italic: !!set.hlItalic
      }
    : undefined
  const s1 = wordSpans(spec.scene1, 0.35, Math.max(0.5, tSplit - 0.75), hlOpts)
  const hero1Delay = Math.min(0.55, Math.max(0.3, tSplit * 0.3))
  const exitDelay = Math.max(0.4, tSplit - 0.35)

  // Scene 2 timings
  const s2From = tSplit + 0.3
  const s2To = Math.max(s2From + 0.2, D - 0.95)
  const s2 = wordSpans(spec.scene2, s2From, spec.subscribe ? Math.min(s2To, D - 1.6) : s2To, hlOpts)
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
  const underline2Css =
    set.underline2 && spec.kind === 'intro'
      ? '.sc2 .txt{text-decoration:underline;text-decoration-thickness:6px;text-underline-offset:12px}'
      : ''

  // Oversized storyboard badges: per-card badgeFontPx scales the pill's font,
  // padding and radius together (the badge only appears on intro scene 1).
  // The badge NEVER wraps (white-space:nowrap) and uses a fixed design font,
  // so a long exam name (the chip now shows exam_name, e.g. "NJ Real Estate
  // Exam") would run off the frame and crop. Shrink the font so the chip
  // (glyphs + horizontal padding) fits the safe width — long names scale
  // down, short names keep the measured design size. Mirrors effectiveFontPx
  // for scene text (estimation-based; the story card isn't DOM-measured).
  const SAFE_W = NINE_SIXTEEN.width - m.left - m.right
  const fitBadgeFont = (raw: number): number => {
    if (!spec.badge) return raw
    const len = spec.badge.length
    // Spaced badges add letter-spacing AND uppercase (text-transform), both of
    // which widen the chip — account for both or the fit under-shrinks and the
    // long exam name still crops on the spaced sets.
    const spaced = !!set.badge.spaced
    const glyphEm = spaced ? 0.68 : 0.6 // uppercase glyphs run wider
    const trackPx = spaced ? 4 : 2 // letter-spacing from badgeSpacedCss
    const maxW = SAFE_W - 44
    // rendered width(f) = f*glyphEm*len + f (0.5em padding each side) + len*trackPx.
    // Solve width(f) <= maxW directly — the tracking term is fixed, so a plain
    // ratio scale would under-shrink.
    const maxFont = Math.floor((maxW - len * trackPx) / (glyphEm * len + 1))
    return Math.max(24, Math.min(raw, maxFont))
  }
  const rawBadgeFontPx = set.layouts?.intro1?.badgeFontPx
  const badgeFontPx = rawBadgeFontPx ? fitBadgeFont(rawBadgeFontPx) : rawBadgeFontPx
  const badgeSizeCss = badgeFontPx
    ? `font-size:${badgeFontPx}px;padding:${Math.round(badgeFontPx * 0.3)}px ${Math.round(badgeFontPx * 0.5)}px;border-radius:${Math.round(badgeFontPx * 0.44)}px;`
    : ''
  const badgeIsItalic = set.badge.italic || set.italic
  const badgeAlignCss =
    (set.layouts?.intro1?.badgeAlign === 'center' ? 'align-self:center;' : '') +
    (badgeIsItalic ? 'font-style:italic;' : '')
  // Absolute badge placement: designs where the exam-name chip sits away from
  // the scene top (e.g. on OA Guides' typewriter paper). When badgeTop is set,
  // the chip is positioned at that safe-relative Y inside a full-width centering
  // wrapper (clamped into the safe area); otherwise it flows above scene-1 text.
  const badgeTopRaw = set.layouts?.intro1?.badgeTop
  const badgeItalicCss = badgeIsItalic ? 'font-style:italic;' : ''
  // When the badge sits ABOVE the scene-1 hook, the hook must start below the
  // badge's bottom edge — guards against a mis-measured badgeTop overlapping
  // the text (0 = no constraint, e.g. designs where the badge sits below/around
  // the text like set 1's typewriter paper).
  let scene1BadgeClearTop = 0
  let badgeHtml = ''
  if (spec.kind === 'intro' && spec.badge) {
    if (badgeTopRaw !== undefined) {
      const bfp = badgeFontPx ?? 34
      const badgeH = Math.round(bfp * 1.2 + (badgeFontPx ? Math.round(bfp * 0.3) * 2 : 24))
      const badgeTopC = Math.max(0, Math.min(badgeTopRaw, 1380 - badgeH))
      const introTxtTop = set.layouts?.intro1?.txtTop
      if (introTxtTop !== undefined && badgeTopRaw < introTxtTop) {
        scene1BadgeClearTop = badgeTopC + badgeH + 18
      }
      const ba = set.layouts?.intro1?.badgeAlign
      const jc = ba === 'center' ? 'center' : ba === 'right' ? 'flex-end' : 'flex-start'
      const padL = set.layouts?.intro1?.padLeft ?? 0
      badgeHtml =
        `<div style="position:absolute;left:0;right:0;top:${badgeTopC}px;display:flex;justify-content:${jc};${padL ? `padding-left:${padL}px;` : ''}${ba === 'right' ? 'padding-right:0;' : ''}">` +
        `<div class="badge" style="${badgeSizeCss}${badgeItalicCss}margin-top:0;animation-delay:${badgeDelay.toFixed(2)}s">${esc(spec.badge)}</div></div>`
    } else {
      badgeHtml = `<div class="badge" style="${badgeSizeCss}${badgeAlignCss}animation-delay:${badgeDelay.toFixed(2)}s">${esc(spec.badge)}</div>`
    }
  }

  // Per-card layouts: the set's storyboard-tuned overrides on top of the
  // generic defaults. Heroes use the uploaded PNG when present, else the
  // code-drawn fallback, placed exactly where the layout anchors them —
  // including bleeds off the frame edges (#stage clips them).
  const layoutFor = (card: CardKey): CardLayout => set.layouts?.[card] ?? DEFAULT_CARD_LAYOUTS[card]

  // ---- SAFE-ZONE CLAMPS -------------------------------------------------
  // Designer frames sometimes place elements outside the safe area (the
  // designer doesn't know the zones). The measured layout values document
  // the design; these clamps GUARANTEE every system-drawn overlay (badge,
  // texts, pill, arrow) stays inside safe bounds — top ≥ the safe line,
  // bottom clear of the caption zone — using the same conservative text
  // estimate as the crop-proof arrow fit.
  const SAFE_ZONE_H = 1380 // 1920 − 160 top − 380 caption margin
  const estTextH = (l: CardLayout, text: string): number => {
    const f = l.fontPx ? effectiveFontPx(l.fontPx, text, l.fontBaseChars) : textSizeFor(text)
    const lines = Math.max(1, Math.ceil((text.length * f * 0.55) / 960))
    return lines * f * 1.2
  }
  const clampTxtTop = (l: CardLayout, text: string): number =>
    Math.round(Math.max(0, Math.min(l.txtTop ?? 0, SAFE_ZONE_H - estTextH(l, text))))
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
  const SAFE_H = SAFE_ZONE_H
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
  // Safe-zone clamps for the CTA: the pill must end inside the safe area;
  // the arrow (its full height + bob travel) must too — a design that runs
  // into the caption zone gets a proportionally shorter arrow instead.
  const pillHPx = (l2cta.pillFontPx ?? 38) * 1.16 + (l2cta.pillFontPx ? Math.round(l2cta.pillFontPx * 0.84) : 32)
  const pillTopClamped =
    l2cta.pillTop !== undefined ? Math.max(0, Math.min(l2cta.pillTop, SAFE_ZONE_H - Math.round(pillHPx))) : undefined
  const ARROW_MIN = 200
  const arrowTopClamped =
    l2cta.arrowTop !== undefined
      ? Math.max(0, Math.min(l2cta.arrowTop, SAFE_ZONE_H - 24 - ARROW_MIN))
      : undefined
  const arrowHFinal =
    arrowTopClamped !== undefined
      ? Math.max(ARROW_MIN, Math.min(l2cta.arrowH ?? arrowH, SAFE_ZONE_H - arrowTopClamped - 24))
      : (l2cta.arrowH ?? arrowH)
  const arrowHeightArg =
    set.arrowStyle === 'block' ? arrowHFinal / 0.52 : set.arrowStyle === 'thin' ? arrowHFinal / 0.75 : arrowHFinal
  const absCenter = 'position:absolute;left:0;right:0;display:flex;justify-content:center;margin-top:0;'
  const pillPosCss = pillTopClamped !== undefined ? `${absCenter}top:${pillTopClamped}px;` : ''
  const arrowPosCss = arrowTopClamped !== undefined ? `${absCenter}top:${arrowTopClamped}px;` : ''
  const ctaHtml = spec.subscribe
    ? `${ctaImgHtml}
      ${set.noPill ? '' : `<div class="cta-pop" style="${pillPosCss}animation-delay:${pillDelay.toFixed(2)}s">${pillHtml(set, pulseDelay, l2cta.pillFontPx)}</div>`}
      <div class="arrow-pop" style="${arrowPosCss}animation-delay:${arrowDelay.toFixed(2)}s">
        <div class="bob" style="animation-delay:${bobDelay.toFixed(2)}s">${arrowSvgStyled(set.arrowStyle, set.arrowColor, arrowHeightArg, arrowDelay + 0.1)}</div>
      </div>`
    : ''

  const fontParam = set.font.trim().replace(/\s+/g, '+')
  const weightList = set.weights.split(';')
  const needsItalic = set.italic || !!set.hlItalic || !!set.badge.italic
  const fontAxis = needsItalic
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
  .txt{${set.textOutline ? `color:transparent;-webkit-text-stroke:4px ${set.textOutline};` : `color:${set.ink};`}font-weight:${set.textWeight ?? 900};${capsCss}${italicCss}${spacedCss}line-height:1.16;max-width:100%;
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
  .sub-brand{background:${set.pillColor ?? set.badge.bg};padding:16px 44px}
  .sub-brand .sub-label{color:${set.badge.ink}}
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
      <div class="txt" style="font-size:${layoutFor(card1).fontPx ? effectiveFontPx(layoutFor(card1).fontPx!, spec.scene1, layoutFor(card1).fontBaseChars) : textSizeFor(spec.scene1)}px${layoutFor(card1).ink ? `;color:${layoutFor(card1).ink}` : ''}${layoutFor(card1).txtTop !== undefined ? `;position:absolute;top:${Math.max(clampTxtTop(layoutFor(card1), spec.scene1), scene1BadgeClearTop)}px;left:${layoutFor(card1).padLeft ?? 0}px;right:0;margin-top:0` : ''}">${s1.html}</div>
      ${hero1Abs}
    </div>
    <div class="scene sc2" style="${sceneStyle(card2)}">
      <div class="txt" style="font-size:${layoutFor(card2).fontPx ? effectiveFontPx(layoutFor(card2).fontPx!, spec.scene2, layoutFor(card2).fontBaseChars) : textSizeFor(spec.scene2)}px;margin-top:60px${layoutFor(card2).ink ? `;color:${layoutFor(card2).ink}` : ''}${layoutFor(card2).txtTop !== undefined ? `;position:absolute;top:${clampTxtTop(layoutFor(card2), spec.scene2)}px;left:${layoutFor(card2).padLeft ?? 0}px;right:0;margin-top:0` : ''}">${s2.html}</div>
      ${spec.kind === 'intro' ? hero2Html : ctaHtml}
    </div>
  </div>
</div>
</body>
</html>`
}
