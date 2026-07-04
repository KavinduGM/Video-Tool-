import Store from 'electron-store'
import { app } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSettings, VoiceProfile, MusicProfile } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  anthropic_api_key: '',
  claude_model: 'claude-opus-4-8',
  elevenlabs_api_key: '',
  default_output_folder: '',
  hyperframes_command: 'npx hyperframes',
  background_music_path: '',
  transition_sound_path: ''
}

interface SchemaShape {
  settings: AppSettings
  voiceProfiles: VoiceProfile[]
  musicProfiles: MusicProfile[]
}

let store: Store<SchemaShape> | null = null

function getStore(): Store<SchemaShape> {
  if (!store) {
    store = new Store<SchemaShape>({
      name: 'ai-video-creator',
      cwd: app.getPath('userData'),
      defaults: {
        settings: { ...DEFAULT_SETTINGS, default_output_folder: app.getPath('desktop') },
        voiceProfiles: [],
        musicProfiles: []
      }
    })
  }
  return store
}

/**
 * Read settings, migrating any pre-ElevenLabs shape on the fly. Old installs had
 * `tts_base_url` / `tts_api_key` from the self-hosted voice-clone server; we drop
 * the URL entirely and, if the user never set the new ElevenLabs key, seed it
 * from the old TTS key so they don't lose their input on first launch. The
 * persisted shape is rewritten so the migration only runs once.
 */
export function getSettings(): AppSettings {
  const raw = getStore().get('settings') as AppSettings & {
    tts_base_url?: string
    tts_api_key?: string
  }
  const needsMigration =
    raw.elevenlabs_api_key === undefined ||
    raw.tts_base_url !== undefined ||
    raw.tts_api_key !== undefined ||
    raw.background_music_path === undefined ||
    raw.transition_sound_path === undefined
  if (!needsMigration) return raw
  const migrated: AppSettings = {
    anthropic_api_key: raw.anthropic_api_key ?? '',
    claude_model: raw.claude_model ?? DEFAULT_SETTINGS.claude_model,
    elevenlabs_api_key: raw.elevenlabs_api_key || raw.tts_api_key || '',
    default_output_folder: raw.default_output_folder ?? '',
    hyperframes_command: raw.hyperframes_command ?? DEFAULT_SETTINGS.hyperframes_command,
    background_music_path: raw.background_music_path ?? '',
    transition_sound_path: raw.transition_sound_path ?? ''
  }
  getStore().set('settings', migrated)
  return migrated
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next = { ...current, ...patch }
  getStore().set('settings', next)
  return next
}

export function listProfiles(): VoiceProfile[] {
  return getStore().get('voiceProfiles')
}

export function upsertProfile(profile: VoiceProfile): VoiceProfile {
  const list = listProfiles()
  const idx = list.findIndex((p) => p.id === profile.id)
  if (idx >= 0) list[idx] = profile
  else list.push(profile)
  getStore().set('voiceProfiles', list)
  return profile
}

export function deleteProfile(id: string): void {
  const list = listProfiles().filter((p) => p.id !== id)
  getStore().set('voiceProfiles', list)
}

export function findProfileByName(name: string): VoiceProfile | undefined {
  return listProfiles().find((p) => p.name.toLowerCase() === name.toLowerCase())
}

// ---- Named background-music profiles ----

export function listMusic(): MusicProfile[] {
  return (getStore().get('musicProfiles') as MusicProfile[]) ?? []
}

export function upsertMusic(profile: { id?: string; name: string; path: string }): MusicProfile {
  const list = listMusic()
  const item: MusicProfile = { id: profile.id || randomUUID(), name: profile.name.trim(), path: profile.path }
  const idx = list.findIndex((m) => m.id === item.id)
  if (idx >= 0) list[idx] = item
  else list.push(item)
  getStore().set('musicProfiles', list)
  return item
}

export function deleteMusic(id: string): void {
  getStore().set(
    'musicProfiles',
    listMusic().filter((m) => m.id !== id)
  )
}

export function findMusicByName(name: string): MusicProfile | undefined {
  return listMusic().find((m) => m.name.toLowerCase() === name.trim().toLowerCase())
}

export function getStoragePaths() {
  return {
    userData: app.getPath('userData'),
    workspace: path.join(app.getPath('userData'), 'workspace'),
    db: path.join(app.getPath('userData'), 'queue.json')
  }
}
