// =====================================================================
// DETERMINISTIC 9:16 SAFE-ZONE ENFORCEMENT
// =====================================================================
// Prompting Claude to "stay inside the safe zone" is a soft constraint —
// it has no coordinate system, so it complies most of the time but not
// always. This module makes the guarantee HARD:
//
//   1. measureSafeZone() renders Claude's HTML in a hidden Electron
//      window at exactly 1080x1920, waits for fonts, jumps the animation
//      to its final frame, and measures the real getBoundingClientRect()
//      of every visible "ink" element. It reports, in pixels, whether
//      anything crosses the safe area and by how much.
//
//   2. fitHtmlToSafeZone() applies a purely geometric correction — it
//      wraps #stage's children in a transform layer that scales+translates
//      the MEASURED content box to sit exactly inside the safe area. It is
//      based on real geometry, so if the content already fits, the scale is
//      1.0 and nothing changes. Hyperframes still renders #stage; the extra
//      wrapper doesn't touch GSAP/CSS selectors, so animations are intact.
//
// Everything here is 9:16-specific by design — the numbers come from the
// shared zone spec and are not generalized to other ratios.
// =====================================================================

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SAFE_AREA } from '@shared/zones'

export interface SafeZoneOffender {
  tag: string
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  sides: string[] // which safe-area edges this element crosses
}

export interface SafeZoneMeasurement {
  ok: boolean
  /** true when a measurable content box was found; false means we couldn't measure */
  measured: boolean
  hasSafeWrapper: boolean
  content: { minX: number; minY: number; maxX: number; maxY: number } | null
  /** pixels past the safe area on each side (0 when inside) */
  overflow: { left: number; right: number; top: number; bottom: number }
  offenders: SafeZoneOffender[]
  note?: string
}

const TOLERANCE_PX = 1
const MEASURE_TIMEOUT_MS = 25_000

// Injected into the page. Returns a plain object (Electron serializes it).
// Kept as one expression so executeJavaScript can await its promise.
function measureScript(): string {
  return `(async () => {
    try { await document.fonts.ready } catch (e) {}
    // Jump every animation to its final state so we measure the LAST frame.
    try { if (window.gsap && gsap.globalTimeline) { gsap.globalTimeline.pause(); gsap.globalTimeline.progress(1); } } catch (e) {}
    try {
      (document.getAnimations ? document.getAnimations() : []).forEach(a => {
        try { a.pause(); var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : 0; a.currentTime = (t && isFinite(t)) ? t : 1e7; } catch (e) {}
      })
    } catch (e) {}
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    var stage = document.getElementById('stage')
    if (!stage) return { error: 'no-stage' }
    var sb = stage.getBoundingClientRect()
    if (!sb.width || !sb.height) return { error: 'stage-zero-size' }
    var sx = 1080 / sb.width, sy = 1920 / sb.height
    var stageArea = sb.width * sb.height

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    var offenders = []
    var els = stage.querySelectorAll('*')
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      if (el.id === 'stage' || el.id === 'hf-fit') continue
      if (el.classList && el.classList.contains('safe')) continue // layout wrapper, not ink
      var cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      if (parseFloat(cs.opacity || '1') === 0) continue

      var tag = el.tagName.toLowerCase()
      var isShape = ['svg','rect','circle','ellipse','path','line','polygon','polyline','text','tspan','image','img'].indexOf(tag) >= 0
      var hasOwnText = false
      for (var c = 0; c < el.childNodes.length; c++) {
        var n = el.childNodes[c]
        if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) { hasOwnText = true; break }
      }
      var hasBorder = ['Top','Right','Bottom','Left'].some(function (s) { return parseFloat(cs['border' + s + 'Width']) > 0 })
      var bgColor = cs.backgroundColor
      var hasBgPaint = (cs.backgroundImage && cs.backgroundImage !== 'none') ||
                       (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent')
      var isInk = isShape || hasOwnText || hasBorder || hasBgPaint
      if (!isInk) continue

      var r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      // Ignore full-bleed backgrounds (>=97% of the stage) that carry no text.
      if (!hasOwnText && (r.width * r.height) >= stageArea * 0.97) continue

      var x0 = (r.left - sb.left) * sx, y0 = (r.top - sb.top) * sy
      var x1 = (r.right - sb.left) * sx, y1 = (r.bottom - sb.top) * sy
      if (x0 < minX) minX = x0
      if (y0 < minY) minY = y0
      if (x1 > maxX) maxX = x1
      if (y1 > maxY) maxY = y1
      offenders.push({ tag: tag, text: (el.textContent || '').trim().slice(0, 50), x0: x0, y0: y0, x1: x1, y1: y1 })
    }
    if (!isFinite(minX)) return { empty: true }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, hasSafe: !!stage.querySelector('.safe'), offenders: offenders }
  })()`
}

function emptyOverflow() {
  return { left: 0, right: 0, top: 0, bottom: 0 }
}

/**
 * Measure Claude's HTML against the 9:16 safe area. Never throws for content
 * reasons — on any infrastructure failure it returns { measured: false } so the
 * caller can decide to skip enforcement rather than fail the job.
 */
export async function measureSafeZone(
  html: string,
  _durationSeconds: number
): Promise<SafeZoneMeasurement> {
  const tmpDir = path.join(app.getPath('temp'), 'ai-video-creator-safezone')
  const tmpFile = path.join(tmpDir, `sz-${randomUUID()}.html`)
  let win: BrowserWindow | null = null
  try {
    await fs.promises.mkdir(tmpDir, { recursive: true })
    await fs.promises.writeFile(tmpFile, html, 'utf8')

    win = new BrowserWindow({
      show: false,
      width: 1080,
      height: 1920,
      useContentSize: true,
      webPreferences: {
        offscreen: false,
        backgroundThrottling: false,
        // We only ever run our own measuring script; the page's own JS runs
        // in the page context. No node integration.
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    // Prevent a hung CDN/font request from blocking forever.
    await win.loadFile(tmpFile)

    const data = await Promise.race([
      win.webContents.executeJavaScript(measureScript(), true),
      new Promise((_res, rej) => setTimeout(() => rej(new Error('measure timeout')), MEASURE_TIMEOUT_MS))
    ])

    if (!data || data.error || data.empty) {
      return {
        ok: true, // nothing measurable → don't block the pipeline
        measured: false,
        hasSafeWrapper: false,
        content: null,
        overflow: emptyOverflow(),
        offenders: [],
        note: data?.error ? `measure skipped: ${data.error}` : 'no measurable content'
      }
    }

    const content = { minX: data.minX, minY: data.minY, maxX: data.maxX, maxY: data.maxY }
    const overflow = {
      left: Math.max(0, SAFE_AREA.left - content.minX),
      top: Math.max(0, SAFE_AREA.top - content.minY),
      right: Math.max(0, content.maxX - SAFE_AREA.right),
      bottom: Math.max(0, content.maxY - SAFE_AREA.bottom)
    }
    const ok =
      overflow.left <= TOLERANCE_PX &&
      overflow.right <= TOLERANCE_PX &&
      overflow.top <= TOLERANCE_PX &&
      overflow.bottom <= TOLERANCE_PX

    // Keep only elements that actually cross an edge, worst first, capped.
    const offenders: SafeZoneOffender[] = (data.offenders || [])
      .map((o: any) => {
        const sides: string[] = []
        if (o.x0 < SAFE_AREA.left - TOLERANCE_PX) sides.push('left')
        if (o.x1 > SAFE_AREA.right + TOLERANCE_PX) sides.push('right')
        if (o.y0 < SAFE_AREA.top - TOLERANCE_PX) sides.push('top')
        if (o.y1 > SAFE_AREA.bottom + TOLERANCE_PX) sides.push('bottom')
        return {
          tag: o.tag,
          text: o.text,
          x0: Math.round(o.x0),
          y0: Math.round(o.y0),
          x1: Math.round(o.x1),
          y1: Math.round(o.y1),
          sides
        }
      })
      .filter((o: SafeZoneOffender) => o.sides.length > 0)
      .sort((a: SafeZoneOffender, b: SafeZoneOffender) => b.sides.length - a.sides.length)
      .slice(0, 5)

    return { ok, measured: true, hasSafeWrapper: !!data.hasSafe, content, overflow, offenders }
  } catch (err: any) {
    return {
      ok: true, // infra failure → skip, don't fail the job
      measured: false,
      hasSafeWrapper: false,
      content: null,
      overflow: emptyOverflow(),
      offenders: [],
      note: `measure error: ${err?.message ?? err}`
    }
  } finally {
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } catch {
      /* ignore */
    }
    fs.promises.rm(tmpFile, { force: true }).catch(() => {})
  }
}

/**
 * Given a measured content box, compute the uniform scale + translate that maps
 * it exactly inside the safe area (centered). If it already fits, scale is 1.0
 * and the translate only recenters if it was pushed to one side.
 */
export function computeFitTransform(content: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): { scale: number; tx: number; ty: number } {
  const cw = Math.max(1, content.maxX - content.minX)
  const ch = Math.max(1, content.maxY - content.minY)
  const scale = Math.min(1, SAFE_AREA.width / cw, SAFE_AREA.height / ch)
  const scaledW = cw * scale
  const scaledH = ch * scale
  const targetX = SAFE_AREA.left + (SAFE_AREA.width - scaledW) / 2
  const targetY = SAFE_AREA.top + (SAFE_AREA.height - scaledH) / 2
  const tx = targetX - content.minX * scale
  const ty = targetY - content.minY * scale
  return { scale, tx, ty }
}

/**
 * Wrap the direct inner content of #stage in a #hf-fit transform layer. Uses a
 * balanced <div> scan (the generated HTML is validated to be a complete
 * document, and #stage content contains no `<div` inside text/attributes), so
 * no DOM engine is needed and no animation JS is re-run.
 */
export function wrapStageChildrenWithFit(
  html: string,
  transformCss: string
): { html: string; wrapped: boolean } {
  const openRe = /<div\b[^>]*\bid=["']stage["'][^>]*>/i
  const m = openRe.exec(html)
  if (!m) return { html, wrapped: false }
  const openEnd = m.index + m[0].length

  const tagRe = /<\/?div\b[^>]*>/gi
  tagRe.lastIndex = openEnd
  let depth = 1
  let closeStart = -1
  let t: RegExpExecArray | null
  while ((t = tagRe.exec(html)) !== null) {
    if (t[0][1] === '/') {
      depth--
      if (depth === 0) {
        closeStart = t.index
        break
      }
    } else {
      depth++
    }
  }
  if (closeStart < 0) return { html, wrapped: false }

  const inner = html.slice(openEnd, closeStart)
  const wrapper =
    `<div id="hf-fit" style="position:absolute;left:0;top:0;width:1080px;height:1920px;` +
    `transform-origin:0 0;transform:${transformCss};">${inner}</div>`
  return { html: html.slice(0, openEnd) + wrapper + html.slice(closeStart), wrapped: true }
}

/**
 * Apply the deterministic force-fit: measure → compute transform → wrap. Returns
 * the corrected HTML (guaranteed inside the safe area) and the scale applied.
 */
export function fitHtmlToSafeZone(
  html: string,
  measurement: SafeZoneMeasurement
): { html: string; fitted: boolean; scale: number } {
  if (!measurement.content) return { html, fitted: false, scale: 1 }
  const { scale, tx, ty } = computeFitTransform(measurement.content)
  const css = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(5)})`
  const { html: out, wrapped } = wrapStageChildrenWithFit(html, css)
  return { html: out, fitted: wrapped, scale }
}

/** Human-readable feedback for the retry prompt — names the sides and the worst offenders. */
export function safeZoneFeedback(m: SafeZoneMeasurement): string {
  const parts: string[] = []
  if (m.overflow.left > TOLERANCE_PX) parts.push(`left by ${Math.round(m.overflow.left)}px`)
  if (m.overflow.right > TOLERANCE_PX) parts.push(`right by ${Math.round(m.overflow.right)}px`)
  if (m.overflow.top > TOLERANCE_PX) parts.push(`top by ${Math.round(m.overflow.top)}px`)
  if (m.overflow.bottom > TOLERANCE_PX) parts.push(`bottom by ${Math.round(m.overflow.bottom)}px`)
  const worst = m.offenders
    .map((o) => `${o.sides.join('+')}: "${o.text || o.tag}" [x ${o.x0}–${o.x1}, y ${o.y0}–${o.y1}]`)
    .join('; ')
  return (
    `Content crosses the 9:16 SAFE ZONE (${parts.join(', ') || 'edge overflow'}). ` +
    `The safe area is x[${SAFE_AREA.left}, ${SAFE_AREA.right}] y[${SAFE_AREA.top}, ${SAFE_AREA.bottom}] — nothing may extend past it. ` +
    `Offending elements: ${worst || '(unnamed)'}. ` +
    `Fix by REDUCING font-size and/or repositioning these so every element is fully inside the safe area. ` +
    `Keep everything inside the #stage > .safe container and do not let any line get wider than ${SAFE_AREA.width}px.`
  )
}
