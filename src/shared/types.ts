// Types shared between the Electron main process and the React renderer.

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '21:9'

export interface RatioDimensions {
  width: number
  height: number
}

export const RATIO_DIMENSIONS: Record<AspectRatio, RatioDimensions> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '21:9': { width: 2560, height: 1080 }
}

export type TransitionType =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'slide_left'
  | 'slide_right'
  | 'slide_up'
  | 'slide_down'
  | 'wipe_left'
  | 'wipe_right'
  | 'wipe_up'
  | 'wipe_down'

export interface Transition {
  type: TransitionType
  duration: number // seconds
}

export interface SceneSpec {
  explainer: string
  voiceover: string
  transition_out: Transition
}

export interface ScriptSpec {
  video_name: string
  ratio: AspectRatio
  output_folder: string
  voice_profile: string // display name of saved profile
  voice_speed?: number
  style?: {
    description?: string
    colors?: string[]
    fonts?: string[]
  }
  scenes: SceneSpec[]
}

export interface VoiceProfile {
  id: string
  name: string
  description: string
  voice_id: string // ElevenLabs voice ID
  default_speed: number // ElevenLabs supports 0.7–1.2 on Turbo v2
}

export interface AppSettings {
  anthropic_api_key: string
  claude_model: string
  elevenlabs_api_key: string
  default_output_folder: string
  hyperframes_command: string // e.g. "npx hyperframes" or absolute path
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface JobLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface Job {
  id: string
  created_at: number
  updated_at: number
  status: JobStatus
  script_yaml: string
  script_path?: string
  video_name: string
  output_path?: string
  error?: string
  progress: number // 0..1
  current_step?: string
  logs: JobLogEntry[]
}

export interface QueueEvent {
  type: 'created' | 'updated' | 'removed'
  job: Job
}

/**
 * Result of importing a multi-script .md document. Partial success is
 * supported — `queued` is whatever parsed cleanly, `errors` is the rest
 * with the original 1-based index in the document and (best-effort) the
 * video_name we could sniff out before parsing failed.
 */
export interface DocumentEnqueueResult {
  queued: Job[]
  errors: { index: number; videoName?: string; message: string }[]
  total: number
}

// IPC channel names
export const IPC = {
  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  // voice profiles
  PROFILES_LIST: 'profiles:list',
  PROFILES_UPSERT: 'profiles:upsert',
  PROFILES_DELETE: 'profiles:delete',
  // queue / jobs
  JOB_ENQUEUE: 'job:enqueue',
  JOB_ENQUEUE_FILE: 'job:enqueue-file',
  JOB_ENQUEUE_DOCUMENT: 'job:enqueue-document',
  JOB_LIST: 'job:list',
  JOB_CANCEL: 'job:cancel',
  JOB_REMOVE: 'job:remove',
  JOB_CLEAR: 'job:clear',
  JOB_RETRY: 'job:retry',
  JOB_GET: 'job:get',
  JOB_EVENT: 'job:event', // main → renderer
  // misc
  PICK_FOLDER: 'dialog:pick-folder',
  PICK_SCRIPT: 'dialog:pick-script',
  PICK_DOCUMENT: 'dialog:pick-document',
  OPEN_PATH: 'shell:open-path',
  TEMPLATE_GET: 'template:get',
  TTS_HEALTH: 'tts:health',
  TTS_VOICES: 'tts:voices',
  // learned scene-template library
  TEMPLATES_COUNT: 'templates:count',
  TEMPLATES_CLEAR: 'templates:clear'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
