import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/types'
import type {
  AppSettings,
  VoiceProfile,
  QueueEvent,
  DocumentEnqueueResult,
  Job
} from '@shared/types'
import {
  getSettings,
  setSettings,
  listProfiles,
  upsertProfile,
  deleteProfile
} from './settings'
import { createJob, deleteJob, getJob, listJobs, resetJob, updateJob } from './db'
import { worker } from './worker'
import { parseScript } from './pipeline/parser'
import { ttsHealth, listVoices } from './pipeline/tts'
import { extractScriptsFromDocument, sniffVideoName } from './pipeline/document'
import { templateCount, clearTemplates } from './pipeline/templates'

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => setSettings(patch))

  ipcMain.handle(IPC.PROFILES_LIST, () => listProfiles())
  ipcMain.handle(IPC.PROFILES_UPSERT, (_e, raw: VoiceProfile) => {
    // ElevenLabs Turbo v2 honors voice_settings.speed in the 0.7–1.2 range —
    // anything outside that is silently ignored server-side, so clamp here so
    // the saved value matches what the API will actually use.
    const profile: VoiceProfile = {
      ...raw,
      id: raw.id || randomUUID(),
      default_speed: clamp(Number(raw.default_speed) || 1.0, 0.7, 1.2)
    }
    return upsertProfile(profile)
  })
  ipcMain.handle(IPC.PROFILES_DELETE, (_e, id: string) => deleteProfile(id))

  ipcMain.handle(IPC.JOB_ENQUEUE, (_e, args: { script_yaml: string }) => {
    const spec = parseScript(args.script_yaml)
    const job = createJob({
      video_name: spec.video_name,
      script_yaml: args.script_yaml
    })
    broadcast({ type: 'created', job })
    worker.wake()
    return job
  })

  ipcMain.handle(IPC.JOB_ENQUEUE_FILE, async (_e, filePath: string) => {
    const yaml = await fs.promises.readFile(filePath, 'utf8')
    const spec = parseScript(yaml)
    const job = createJob({
      video_name: spec.video_name,
      script_yaml: yaml,
      script_path: filePath
    })
    broadcast({ type: 'created', job })
    worker.wake()
    return job
  })

  /**
   * Multi-script import. Reads a .md document, pulls out every YAML script in
   * it (fenced ```yaml blocks or `---`-separated docs), and enqueues each one.
   * Per-script failures are returned alongside the successes — we don't abort
   * the whole batch because the user paid the cost of writing 9 working
   * scripts and 1 broken one and would be furious if we discarded the 9.
   */
  ipcMain.handle(
    IPC.JOB_ENQUEUE_DOCUMENT,
    async (_e, filePath: string): Promise<DocumentEnqueueResult> => {
      const text = await fs.promises.readFile(filePath, 'utf8')
      const chunks = extractScriptsFromDocument(text)
      if (chunks.length === 0) {
        throw new Error(
          `No scripts found in ${path.basename(filePath)}. Expected one or more YAML scripts, either wrapped in \`\`\`yaml fenced code blocks or separated by lines that contain just \`---\`. Each script must include a \`video_name:\` line.`
        )
      }
      const queued: Job[] = []
      const errors: DocumentEnqueueResult['errors'] = []
      for (let i = 0; i < chunks.length; i++) {
        try {
          const spec = parseScript(chunks[i])
          const job = createJob({
            video_name: spec.video_name,
            script_yaml: chunks[i],
            script_path: filePath
          })
          broadcast({ type: 'created', job })
          queued.push(job)
        } catch (err: any) {
          errors.push({
            index: i + 1,
            videoName: sniffVideoName(chunks[i]),
            message: err?.message ?? String(err)
          })
        }
      }
      if (queued.length > 0) worker.wake()
      return { queued, errors, total: chunks.length }
    }
  )

  ipcMain.handle(IPC.JOB_LIST, () => listJobs())
  ipcMain.handle(IPC.JOB_GET, (_e, id: string) => getJob(id))
  ipcMain.handle(IPC.JOB_CANCEL, (_e, id: string) => {
    const job = getJob(id)
    if (!job) return null
    if (job.status === 'running' && worker.currentJob() === id) {
      worker.cancelCurrent()
      return { ok: true }
    }
    if (job.status === 'queued') {
      const j = updateJob(id, { status: 'cancelled', current_step: 'Cancelled' })
      if (j) broadcast({ type: 'updated', job: j })
      return { ok: true }
    }
    return { ok: false, reason: `Job in status ${job.status} can't be cancelled.` }
  })
  ipcMain.handle(IPC.JOB_REMOVE, (_e, id: string) => {
    const job = getJob(id)
    if (!job) return null
    if (job.status === 'running') return { ok: false, reason: 'Cancel first.' }
    deleteJob(id)
    broadcast({ type: 'removed', job })
    return { ok: true }
  })
  ipcMain.handle(IPC.JOB_RETRY, (_e, id: string) => {
    const job = resetJob(id)
    if (job) {
      broadcast({ type: 'updated', job })
      worker.wake()
    }
    return job
  })

  ipcMain.handle(IPC.PICK_FOLDER, async (_e, defaultPath?: string) => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.PICK_SCRIPT, async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'YAML script', extensions: ['yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle(IPC.PICK_DOCUMENT, async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown / script document', extensions: ['md', 'markdown', 'txt', 'yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.OPEN_PATH, async (_e, target: string) => {
    if (!target) return
    if (fs.existsSync(target)) {
      shell.showItemInFolder(target)
    } else {
      await shell.openPath(path.dirname(target))
    }
  })

  ipcMain.handle(IPC.TEMPLATE_GET, async () => {
    const candidates = [
      path.join(process.resourcesPath || '', 'templates', 'script.template.yml'),
      path.join(__dirname, '..', '..', 'templates', 'script.template.yml'),
      path.join(__dirname, '..', '..', '..', 'templates', 'script.template.yml')
    ]
    for (const p of candidates) {
      try {
        return await fs.promises.readFile(p, 'utf8')
      } catch {
        // try next
      }
    }
    return ''
  })

  ipcMain.handle(IPC.TTS_HEALTH, async () => {
    const s = getSettings()
    return ttsHealth({ apiKey: s.elevenlabs_api_key })
  })

  ipcMain.handle(IPC.TTS_VOICES, async () => {
    const s = getSettings()
    return listVoices({ apiKey: s.elevenlabs_api_key })
  })

  ipcMain.handle(IPC.TEMPLATES_COUNT, () => templateCount())
  ipcMain.handle(IPC.TEMPLATES_CLEAR, () => {
    clearTemplates()
    return { ok: true }
  })

  worker.on('event', (event: QueueEvent) => {
    broadcast(event)
  })

  function broadcast(event: QueueEvent): void {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.JOB_EVENT, event)
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
