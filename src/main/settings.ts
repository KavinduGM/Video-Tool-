import Store from 'electron-store'
import { app } from 'electron'
import path from 'node:path'
import type { AppSettings, VoiceProfile } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  anthropic_api_key: '',
  claude_model: 'claude-opus-4-7',
  tts_base_url: 'http://localhost:8000',
  tts_api_key: '',
  default_output_folder: '',
  hyperframes_command: 'npx hyperframes'
}

interface SchemaShape {
  settings: AppSettings
  voiceProfiles: VoiceProfile[]
}

let store: Store<SchemaShape> | null = null

function getStore(): Store<SchemaShape> {
  if (!store) {
    store = new Store<SchemaShape>({
      name: 'ai-video-creator',
      cwd: app.getPath('userData'),
      defaults: {
        settings: { ...DEFAULT_SETTINGS, default_output_folder: app.getPath('desktop') },
        voiceProfiles: []
      }
    })
  }
  return store
}

export function getSettings(): AppSettings {
  return getStore().get('settings')
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

export function getStoragePaths() {
  return {
    userData: app.getPath('userData'),
    workspace: path.join(app.getPath('userData'), 'workspace'),
    db: path.join(app.getPath('userData'), 'queue.json')
  }
}
