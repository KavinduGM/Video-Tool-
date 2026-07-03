// =====================================================================
// BURNED-IN KARAOKE CAPTIONS
// =====================================================================
// Builds an ASS subtitle file for the final video from the per-word
// timings ElevenLabs returns with each segment's audio. Style: bold white
// text with a thin black outline, sitting inside the reserved bottom
// caption band (a bit up from the very bottom), with the word currently
// being spoken highlighted in yellow.
//
// Exam-code awareness: tokens like "WGU" + "D320" (or "ATI" + "TEAS", or
// a bare "D514") are merged into ONE caption unit so they highlight as a
// single phrase, never split into fragments.
//
// The captions live in the bottom 380px of the 9:16 frame, which the
// safe-zone system already reserves — no scene content is ever drawn
// there, so captions can't overlap the visuals.
// =====================================================================

import type { WordTiming } from './tts'

export interface CaptionUnit {
  text: string
  start: number
  end: number
}

const TRAIL_PUNCT = /[.,!?;:]+$/

function stripPunct(t: string): string {
  return t.replace(TRAIL_PUNCT, '')
}

/**
 * Merge consecutive tokens that form one exam-style identifier:
 *   "WGU" + "D320"  → "WGU D320"     (acronym + course code)
 *   "ATI" + "TEAS"  → "ATI TEAS"     (acronym + acronym)
 * A token that ends a sentence (trailing . ! ? ; :) never merges forward.
 */
export function mergeExamTokens(words: WordTiming[]): CaptionUnit[] {
  const out: CaptionUnit[] = []
  for (const w of words) {
    const prev = out[out.length - 1]
    if (prev && shouldMerge(prev.text, w.text)) {
      prev.text = `${prev.text} ${w.text}`
      prev.end = w.end
    } else {
      out.push({ text: w.text, start: w.start, end: w.end })
    }
  }
  return out
}

function shouldMerge(prevText: string, nextText: string): boolean {
  if (TRAIL_PUNCT.test(prevText)) return false // sentence boundary
  const lastTok = prevText.split(' ').pop() ?? ''
  const A = stripPunct(lastTok)
  const B = stripPunct(nextText)
  if (!/^[A-Z]{2,6}$/.test(A)) return false
  if (/^[A-Z]{0,3}\d[A-Za-z0-9-]*$/.test(B)) return true // WGU D320, D514…
  if (/^[A-Z]{2,6}$/.test(B)) return true // ATI TEAS
  return false
}

/**
 * Group units into short caption phrases (like the reference style — a few
 * words at a time). Breaks on sentence-ending punctuation, unit count,
 * character budget, or a silence gap.
 */
export function groupIntoChunks(
  units: CaptionUnit[],
  opts: { maxUnits?: number; maxChars?: number; maxGap?: number } = {}
): CaptionUnit[][] {
  const maxUnits = opts.maxUnits ?? 3
  const maxChars = opts.maxChars ?? 26
  const maxGap = opts.maxGap ?? 0.8
  const chunks: CaptionUnit[][] = []
  let cur: CaptionUnit[] = []
  let curLen = 0
  for (const u of units) {
    const wouldBe = curLen + (cur.length ? 1 : 0) + u.text.length
    const gap = cur.length ? u.start - cur[cur.length - 1].end : 0
    if (cur.length && (cur.length >= maxUnits || wouldBe > maxChars || gap > maxGap)) {
      chunks.push(cur)
      cur = []
      curLen = 0
    }
    cur.push(u)
    curLen = curLen ? curLen + 1 + u.text.length : u.text.length
    if (/[.!?]$/.test(u.text)) {
      chunks.push(cur)
      cur = []
      curLen = 0
    }
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

function assTime(t: number): string {
  const total = Math.max(0, t)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.round((total - Math.floor(total)) * 100)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${h}:${pad(m)}:${pad(s)}.${pad(Math.min(cs, 99))}`
}

function escAss(t: string): string {
  return t.replace(/[{}]/g, '').replace(/\r?\n/g, ' ')
}

const HIGHLIGHT = '&H00FFFF&' // ASS colors are BGR — this is yellow
const NORMAL = '&HFFFFFF&' // white

/**
 * Build the complete ASS document. `segments` is one entry per video segment
 * (intro, scenes, outro) with its units already merged and the segment's start
 * OFFSET within the final concatenated video.
 */
export function buildAss(segments: { units: CaptionUnit[]; offset: number }[]): string {
  const events: string[] = []
  for (const seg of segments) {
    const chunks = groupIntoChunks(seg.units)
    for (const chunk of chunks) {
      for (let k = 0; k < chunk.length; k++) {
        const u = chunk[k]
        const start = seg.offset + u.start
        // The chunk stays visible continuously: each word's event runs until the
        // next word begins (last word holds briefly so it doesn't vanish abruptly).
        const rawEnd = k < chunk.length - 1 ? chunk[k + 1].start : chunk[k].end + 0.15
        const end = seg.offset + Math.max(rawEnd, u.start + 0.05)
        const text = chunk
          .map((c, i) =>
            i === k ? `{\\1c${HIGHLIGHT}}${escAss(c.text)}{\\1c${NORMAL}}` : escAss(c.text)
          )
          .join(' ')
        events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`)
      }
    }
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
}
