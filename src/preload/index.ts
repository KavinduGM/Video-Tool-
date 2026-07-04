import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppSettings,
  DocumentEnqueueResult,
  Job,
  MusicProfile,
  QueueEvent,
  VoiceProfile
} from '../shared/types'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, patch)
  },
  profiles: {
    list: (): Promise<VoiceProfile[]> => ipcRenderer.invoke(IPC.PROFILES_LIST),
    upsert: (p: VoiceProfile): Promise<VoiceProfile> =>
      ipcRenderer.invoke(IPC.PROFILES_UPSERT, p),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PROFILES_DELETE, id)
  },
  music: {
    list: (): Promise<MusicProfile[]> => ipcRenderer.invoke(IPC.MUSIC_LIST),
    upsert: (m: { id?: string; name: string; path: string }): Promise<MusicProfile> =>
      ipcRenderer.invoke(IPC.MUSIC_UPSERT, m),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.MUSIC_DELETE, id)
  },
  jobs: {
    enqueue: (script_yaml: string, music_path?: string): Promise<Job> =>
      ipcRenderer.invoke(IPC.JOB_ENQUEUE, { script_yaml, music_path }),
    enqueueFile: (filePath: string, music_path?: string): Promise<Job> =>
      ipcRenderer.invoke(IPC.JOB_ENQUEUE_FILE, filePath, music_path),
    enqueueDocument: (filePath: string, music_path?: string): Promise<DocumentEnqueueResult> =>
      ipcRenderer.invoke(IPC.JOB_ENQUEUE_DOCUMENT, filePath, music_path),
    list: (): Promise<Job[]> => ipcRenderer.invoke(IPC.JOB_LIST),
    get: (id: string): Promise<Job | null> => ipcRenderer.invoke(IPC.JOB_GET, id),
    cancel: (id: string) => ipcRenderer.invoke(IPC.JOB_CANCEL, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.JOB_REMOVE, id),
    clearHistory: (): Promise<{ ok: boolean; removed: number; keptRunning: number }> =>
      ipcRenderer.invoke(IPC.JOB_CLEAR),
    retry: (id: string): Promise<Job | null> => ipcRenderer.invoke(IPC.JOB_RETRY, id),
    onEvent: (cb: (event: QueueEvent) => void) => {
      const handler = (_e: unknown, event: QueueEvent) => cb(event)
      ipcRenderer.on(IPC.JOB_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.JOB_EVENT, handler)
    }
  },
  dialog: {
    pickFolder: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.PICK_FOLDER, defaultPath),
    pickScripts: (): Promise<string[]> => ipcRenderer.invoke(IPC.PICK_SCRIPT),
    pickDocument: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_DOCUMENT),
    pickAudio: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_AUDIO)
  },
  // Electron 32 removed File.path — this returns the absolute path of a
  // drag-and-dropped File so the renderer can use it.
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  shellOpen: (target: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_PATH, target),
  preview: {
    card: (script_yaml: string, part: 'intro' | 'outro'): Promise<{ ok: boolean; message: string; path?: string }> =>
      ipcRenderer.invoke(IPC.PREVIEW_CARD, { script_yaml, part })
  },
  template: {
    get: (): Promise<string> => ipcRenderer.invoke(IPC.TEMPLATE_GET)
  },
  tts: {
    health: (): Promise<{ ok: boolean; detail?: string }> => ipcRenderer.invoke(IPC.TTS_HEALTH),
    voices: (): Promise<unknown> => ipcRenderer.invoke(IPC.TTS_VOICES)
  },
  templates: {
    count: (): Promise<number> => ipcRenderer.invoke(IPC.TEMPLATES_COUNT),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.TEMPLATES_CLEAR)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
