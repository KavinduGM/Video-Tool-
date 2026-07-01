// =====================================================================
// SCENE TEMPLATE LIBRARY (learn-from-successes)
// =====================================================================
// When a scene passes visual review on the FIRST render (no repairs
// needed), it's a proven, well-composed layout. We bank its HTML as a
// reusable template, fingerprinted by a few structural features. Later,
// if a different scene keeps failing review, we find the closest-matching
// template and adapt ONLY its text to the new script — reusing the proven
// structure/animation instead of letting Claude keep re-rolling from
// scratch.
//
// Persisted as JSON in the app's userData folder, alongside the queue.
// =====================================================================

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getStoragePaths } from '../settings'

export interface SceneFeatures {
  ratio: string
  kind: 'text-list' | 'box-list' | 'circle'
  stepCount: number
  lineCount: number
  hasBox: boolean
  hasCircle: boolean
  hasHeading: boolean
}

export interface SceneTemplate {
  id: string
  createdAt: number
  features: SceneFeatures
  html: string
  videoName: string
  explainerPreview: string
}

// Keep the library varied but bounded: at most N templates per structural
// bucket (same ratio+kind+lineCount), and a hard overall cap.
const MAX_PER_BUCKET = 8
const MAX_TOTAL = 400

function templatesFile(): string {
  return path.join(getStoragePaths().userData, 'scene-templates.json')
}

function load(): SceneTemplate[] {
  try {
    const raw = fs.readFileSync(templatesFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(list: SceneTemplate[]): void {
  try {
    fs.writeFileSync(templatesFile(), JSON.stringify(list))
  } catch {
    /* best-effort — the library is an optimization, not critical state */
  }
}

/**
 * Derive a coarse structural fingerprint from a scene's explainer. Deterministic
 * and cheap — no model call. The quoted strings in an explainer are the on-screen
 * text lines, and "Step N" markers count the beats; box/circle keywords set the
 * kind.
 */
export function computeSceneFeatures(ratio: string, explainer: string): SceneFeatures {
  const stepCount = (explainer.match(/^\s*Step\s+\d+/gim) || []).length
  const lineCount = (explainer.match(/"[^"\n]+"/g) || []).length
  const hasBox = /\b(box|rectangle|rectangular)\b/i.test(explainer)
  const hasCircle = /\b(circle|circular)\b/i.test(explainer)
  const hasHeading = /\bheading\b/i.test(explainer)
  const kind: SceneFeatures['kind'] = hasCircle ? 'circle' : hasBox ? 'box-list' : 'text-list'
  return { ratio, kind, stepCount, lineCount, hasBox, hasCircle, hasHeading }
}

function bucketKey(f: SceneFeatures): string {
  return `${f.ratio}|${f.kind}|${f.lineCount}`
}

/**
 * Save a proven composition. `now` is passed in (main-process Date.now) so this
 * module stays free of ambient time for easier testing. Enforces the per-bucket
 * and total caps, evicting the oldest entries first.
 */
export function saveTemplate(
  input: { features: SceneFeatures; html: string; videoName: string; explainerPreview: string },
  now: number
): number {
  const list = load()
  const item: SceneTemplate = {
    id: randomUUID(),
    createdAt: now,
    features: input.features,
    html: input.html,
    videoName: input.videoName,
    explainerPreview: input.explainerPreview.slice(0, 200)
  }
  list.push(item)

  // Evict oldest within the same structural bucket beyond the per-bucket cap.
  const key = bucketKey(item.features)
  const bucket = list.filter((x) => bucketKey(x.features) === key).sort((a, b) => a.createdAt - b.createdAt)
  while (bucket.length > MAX_PER_BUCKET) {
    const drop = bucket.shift()!
    const idx = list.findIndex((x) => x.id === drop.id)
    if (idx >= 0) list.splice(idx, 1)
  }

  // Enforce the overall cap.
  while (list.length > MAX_TOTAL) {
    list.sort((a, b) => a.createdAt - b.createdAt)
    list.shift()
  }

  persist(list)
  return list.length
}

export interface TemplateMatch {
  template: SceneTemplate
  score: number
  distance: number
}

/**
 * Find the closest structural match for a set of features. Hard-filters to the
 * same ratio and kind, then requires the line count to be within 1 of the target
 * (so adapting the text is a near-1:1 swap rather than a restructure). Returns
 * null when nothing is close enough.
 */
export function findBestTemplate(f: SceneFeatures): TemplateMatch | null {
  const candidates = load().filter((t) => t.features.ratio === f.ratio && t.features.kind === f.kind)
  let best: SceneTemplate | null = null
  let bestDist = Infinity
  for (const t of candidates) {
    const dLine = Math.abs(t.features.lineCount - f.lineCount)
    if (dLine > 1) continue // structural mismatch — skip
    const dStep = Math.abs(t.features.stepCount - f.stepCount)
    const dist = dLine * 2 + dStep
    if (dist < bestDist) {
      bestDist = dist
      best = t
    }
  }
  if (!best) return null
  return { template: best, score: 1 / (1 + bestDist), distance: bestDist }
}

export function templateCount(): number {
  return load().length
}

export function clearTemplates(): void {
  persist([])
}
