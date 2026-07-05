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
  | 'diag_wipe' // internal: layered diagonal wipe used at intro/outro joins
  | 'circle_open' // internal: expanding-circle wipe used at intro/outro joins

export interface Transition {
  type: TransitionType
  duration: number // seconds
}

export interface SceneSpec {
  explainer: string
  voiceover: string
  transition_out: Transition
}

export interface IntroOutroSpec {
  voiceover: string
  on_screen: string
  subscribe?: boolean // outro only: system-drawn SUBSCRIBE button + down arrow
  /** extra phrases to highlight; the first on_screen line (the exam name) is always highlighted */
  highlight?: string[]
  /** 2-scene story template: text for scene 1 (both scene1 & scene2 required together) */
  scene1?: string
  /** 2-scene story template: text for scene 2 */
  scene2?: string
}

export interface ScriptSpec {
  video_name: string
  ratio: AspectRatio
  output_folder: string
  voice_profile: string // display name of saved profile
  voice_speed?: number
  background_music?: string // name of a saved music profile (intro/outro bed)
  captions?: boolean // burned-in karaoke captions (default true)
  channel?: string // channel name — shown as the badge chip on story intros
  template_set?: number // force a specific story template set (otherwise hash-picked)
  style?: {
    description?: string
    colors?: string[]
    fonts?: string[]
  }
  intro?: IntroOutroSpec
  outro?: IntroOutroSpec
  scenes: SceneSpec[]
}

export interface VoiceProfile {
  id: string
  name: string
  description: string
  voice_id: string // ElevenLabs voice ID
  default_speed: number // ElevenLabs supports 0.7–1.2 on Turbo v2
}

export interface MusicProfile {
  id: string
  name: string // referenced in a script via background_music
  path: string // absolute path to the audio file
}

export interface AppSettings {
  anthropic_api_key: string
  claude_model: string
  elevenlabs_api_key: string
  default_output_folder: string
  hyperframes_command: string // e.g. "npx hyperframes" or absolute path
  background_music_path: string // global default music for intro/outro (10% volume)
  transition_sound_path: string // whoosh SFX for the intro/outro wipe transition
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'review' // generated script needs the user's manual review before rendering

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
  music_path?: string // optional per-job background-music override
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
  // music profiles
  MUSIC_LIST: 'music:list',
  MUSIC_UPSERT: 'music:upsert',
  MUSIC_DELETE: 'music:delete',
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
  PICK_AUDIO: 'dialog:pick-audio',
  OPEN_PATH: 'shell:open-path',
  TEMPLATE_GET: 'template:get',
  TTS_HEALTH: 'tts:health',
  TTS_VOICES: 'tts:voices',
  // learned scene-template library
  TEMPLATES_COUNT: 'templates:count',
  TEMPLATES_CLEAR: 'templates:clear',
  // fast intro/outro design preview (no TTS, no AI — story card render only)
  PREVIEW_CARD: 'preview:card',
  PREVIEW_EVENT: 'preview:event', // main → renderer progress/result stream
  // script factory: theory document → verified scripts → queue
  FACTORY_GENERATE: 'factory:generate',
  JOB_APPROVE: 'job:approve' // approve (optionally with edits) a needs-review script
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
