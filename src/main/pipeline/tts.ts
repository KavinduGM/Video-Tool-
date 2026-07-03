import fs from 'node:fs'
import type { VoiceProfile } from '@shared/types'

/**
 * ElevenLabs client — locked to the Turbo v2 English-only model per product
 * requirement. Output is always MP3 (the API's default for this endpoint).
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'
const ELEVENLABS_MODEL_ID = 'eleven_turbo_v2' // Turbo v2 English-only

// ElevenLabs voice_settings.speed accepts roughly 0.7–1.2. Clamp here so a stale
// profile from the old self-hosted server (which allowed 0.5–2.0) doesn't 422.
const MIN_SPEED = 0.7
const MAX_SPEED = 1.2

export interface TtsConfig {
  apiKey: string
}

/**
 * Node's global fetch wraps the real network error in err.cause. The visible
 * message ("fetch failed") tells you almost nothing — the cause has the real
 * code (ECONNREFUSED / ENOTFOUND / ETIMEDOUT / EAI_AGAIN / CERT_*). Unwrap it.
 */
function unwrapFetchError(err: unknown, url: string): Error {
  const e = err as any
  const cause = e?.cause
  const parts: string[] = []
  if (e?.name) parts.push(e.name)
  if (e?.message && e.message !== 'fetch failed') parts.push(e.message)
  if (cause) {
    if (cause.code) parts.push(`code=${cause.code}`)
    if (cause.errno) parts.push(`errno=${cause.errno}`)
    if (cause.syscall) parts.push(`syscall=${cause.syscall}`)
    if (cause.hostname) parts.push(`host=${cause.hostname}`)
    if (cause.address) parts.push(`address=${cause.address}`)
    if (cause.port) parts.push(`port=${cause.port}`)
    if (cause.message) parts.push(cause.message)
  }
  const detail = parts.length ? parts.join(' | ') : String(err)
  const friendly = friendlyHint(cause?.code)
  return new Error(`Network error calling ${url}: ${detail}${friendly ? ` — ${friendly}` : ''}`)
}

function friendlyHint(code: string | undefined): string {
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `cannot resolve api.elevenlabs.io — check your internet connection or DNS.`
    case 'ETIMEDOUT':
      return `ElevenLabs didn't respond in time. Check your connection and retry.`
    case 'ECONNREFUSED':
      return `connection refused — likely a proxy/firewall issue between this PC and api.elevenlabs.io.`
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `TLS certificate problem — check the system clock and any corporate MITM proxy.`
    default:
      return ''
  }
}

/**
 * Probe order matters: ElevenLabs API keys now have granular scopes
 * (text_to_speech / voices_read / user_read / models_read / …). A key created
 * with the default "Restricted" preset will 401 on /v1/user even though it
 * works fine for TTS. So we try, in order, the endpoints that progressively
 * fewer keys can reach, and accept the first 2xx:
 *   1. /v1/voices  — needs voices_read (commonly granted, lets us also surface voice count)
 *   2. /v1/models  — needs models_read
 *   3. /v1/user    — needs user_read (lets us surface the subscription tier)
 * If ALL three 401, it's almost certainly a permissions problem rather than a
 * bad key — we say so explicitly so the user knows what to fix.
 */
export async function ttsHealth(cfg: TtsConfig): Promise<{ ok: boolean; detail?: string }> {
  if (!cfg.apiKey) {
    return { ok: false, detail: 'ElevenLabs API key is empty. Fill it in and save.' }
  }
  const headers = { 'xi-api-key': cfg.apiKey }
  const probes: { url: string; describe: (json: any) => string }[] = [
    {
      url: `${ELEVENLABS_BASE}/v1/voices`,
      describe: (j) =>
        `ElevenLabs key OK — ${Array.isArray(j?.voices) ? j.voices.length : '?'} voice(s) available.`
    },
    {
      url: `${ELEVENLABS_BASE}/v1/models`,
      describe: (j) =>
        `ElevenLabs key OK — ${Array.isArray(j) ? j.length : '?'} model(s) available (voices_read scope not granted, so voice listing is disabled).`
    },
    {
      url: `${ELEVENLABS_BASE}/v1/user`,
      describe: (j) => `ElevenLabs key OK (tier: ${j?.subscription?.tier ?? 'unknown'}).`
    }
  ]

  let saw401 = false
  let lastFailureDetail = ''
  for (const probe of probes) {
    try {
      const res = await fetch(probe.url, { method: 'GET', headers })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        return { ok: true, detail: probe.describe(json) }
      }
      if (res.status === 401) {
        saw401 = true
        // Try the next probe — this key just lacks this scope.
        continue
      }
      lastFailureDetail = `HTTP ${res.status} from ${probe.url}: ${(await safeReadText(res)).slice(0, 300)}`
      // Non-401 failure — return immediately; trying further endpoints won't help.
      return { ok: false, detail: lastFailureDetail }
    } catch (err: any) {
      return { ok: false, detail: unwrapFetchError(err, probe.url).message }
    }
  }

  if (saw401) {
    return {
      ok: false,
      detail:
        'HTTP 401 on every probe endpoint. The key is recognized but has no readable scopes — make sure it has at least Text-to-Speech + Voices permission (elevenlabs.io → Profile → API Keys → edit → "Has access to all").'
    }
  }
  return { ok: false, detail: lastFailureDetail || 'ElevenLabs health probe failed for an unknown reason.' }
}

export async function listVoices(cfg: TtsConfig): Promise<unknown> {
  const url = `${ELEVENLABS_BASE}/v1/voices`
  try {
    const res = await fetch(url, {
      headers: { 'xi-api-key': cfg.apiKey }
    })
    if (!res.ok) throw new Error(`listVoices failed: ${res.status} ${await safeReadText(res)}`)
    return res.json()
  } catch (err: any) {
    if (err?.message?.startsWith('listVoices failed:')) throw err
    throw unwrapFetchError(err, url)
  }
}

export interface GenerateArgs {
  text: string
  profile: VoiceProfile
  speedOverride?: number
  outPath: string // expected to end in .mp3 — ElevenLabs Turbo v2 returns MP3
}

export async function generateAudio(cfg: TtsConfig, args: GenerateArgs): Promise<void> {
  if (!cfg.apiKey) {
    throw new Error('ElevenLabs API key is empty. Open Settings and fill it in.')
  }
  if (!args.profile.voice_id) {
    throw new Error(
      `Voice profile "${args.profile.name}" has no ElevenLabs voice_id. Edit the profile and paste the ID from elevenlabs.io → Voices.`
    )
  }

  const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(args.profile.voice_id)}`
  const requestedSpeed = args.speedOverride ?? args.profile.default_speed ?? 1.0
  const speed = clamp(Number(requestedSpeed) || 1.0, MIN_SPEED, MAX_SPEED)

  const body = {
    text: args.text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
      speed
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 min
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': cfg.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (err: any) {
      throw unwrapFetchError(err, url)
    }
    if (!res.ok) {
      const detail = await safeReadText(res)
      const hint =
        res.status === 401
          ? ' — the ElevenLabs API key was rejected.'
          : res.status === 422
          ? ' — request was malformed; check the voice_id and that this voice supports Turbo v2.'
          : res.status === 429
          ? ' — ElevenLabs rate limit / character quota exceeded.'
          : ''
      throw new Error(`ElevenLabs returned HTTP ${res.status} from ${url}: ${detail.slice(0, 500)}${hint}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(args.outPath, buf)
  } finally {
    clearTimeout(timeout)
  }
}

// ====================================================================
// TTS WITH WORD TIMESTAMPS — used for the burned-in karaoke captions.
// ElevenLabs' /with-timestamps endpoint returns the audio plus per-
// character alignment, from which we derive exact per-word timings.
// Deterministic (no speech recognition), so highlights land precisely.
// ====================================================================

export interface WordTiming {
  text: string
  start: number // seconds, relative to this audio clip
  end: number
}

export async function generateAudioWithTimestamps(
  cfg: TtsConfig,
  args: GenerateArgs
): Promise<{ words: WordTiming[] | null; note?: string }> {
  if (!cfg.apiKey) {
    throw new Error('ElevenLabs API key is empty. Open Settings and fill it in.')
  }
  if (!args.profile.voice_id) {
    throw new Error(
      `Voice profile "${args.profile.name}" has no ElevenLabs voice_id. Edit the profile and paste the ID from elevenlabs.io → Voices.`
    )
  }

  const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(args.profile.voice_id)}/with-timestamps?output_format=mp3_44100_128`
  const requestedSpeed = args.speedOverride ?? args.profile.default_speed ?? 1.0
  const speed = clamp(Number(requestedSpeed) || 1.0, MIN_SPEED, MAX_SPEED)
  const body = {
    text: args.text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
      speed
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (err: any) {
      throw unwrapFetchError(err, url)
    }
    if (!res.ok) {
      // The timestamps endpoint failed — fall back to the plain endpoint so the
      // job still produces audio; captions just won't cover this segment.
      const detail = (await safeReadText(res)).slice(0, 300)
      await generateAudio(cfg, args)
      return { words: null, note: `timestamps endpoint HTTP ${res.status} (${detail}) — audio generated without word timings` }
    }
    const json = (await res.json()) as {
      audio_base64?: string
      alignment?: {
        characters?: string[]
        character_start_times_seconds?: number[]
        character_end_times_seconds?: number[]
      }
    }
    if (!json.audio_base64) {
      await generateAudio(cfg, args)
      return { words: null, note: 'timestamps response had no audio — regenerated without timings' }
    }
    await fs.promises.writeFile(args.outPath, Buffer.from(json.audio_base64, 'base64'))

    const a = json.alignment
    if (
      !a ||
      !Array.isArray(a.characters) ||
      !Array.isArray(a.character_start_times_seconds) ||
      !Array.isArray(a.character_end_times_seconds)
    ) {
      return { words: null, note: 'no alignment data in the response — captions will skip this segment' }
    }
    return { words: wordsFromAlignment(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) }
  } finally {
    clearTimeout(timeout)
  }
}

/** Fold per-character alignment into per-word timings (split on whitespace). */
export function wordsFromAlignment(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = []
  let cur = ''
  let curStart = 0
  let lastEnd = 0
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (/\s/.test(c)) {
      if (cur) {
        words.push({ text: cur, start: curStart, end: lastEnd })
        cur = ''
      }
    } else {
      if (!cur) curStart = starts[i] ?? lastEnd
      cur += c
      lastEnd = ends[i] ?? lastEnd
    }
  }
  if (cur) words.push({ text: cur, start: curStart, end: lastEnd })
  return words
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
