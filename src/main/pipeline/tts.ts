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
 * Hit GET /v1/user as a cheap "is this key valid?" probe. 401 → bad key;
 * 200 → key is good. We surface the subscription tier so the user can sanity-
 * check they're hitting the right account.
 */
export async function ttsHealth(cfg: TtsConfig): Promise<{ ok: boolean; detail?: string }> {
  if (!cfg.apiKey) {
    return { ok: false, detail: 'ElevenLabs API key is empty. Fill it in and save.' }
  }
  const url = `${ELEVENLABS_BASE}/v1/user`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': cfg.apiKey }
    })
    if (res.status === 401) {
      return { ok: false, detail: 'HTTP 401 — the ElevenLabs API key was rejected.' }
    }
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${url}: ${await safeReadText(res)}` }
    const json = (await res.json()) as { subscription?: { tier?: string } }
    const tier = json.subscription?.tier ?? 'unknown'
    return { ok: true, detail: `ElevenLabs key OK (tier: ${tier})` }
  } catch (err: any) {
    return { ok: false, detail: unwrapFetchError(err, url).message }
  }
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
