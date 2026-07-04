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
  deleteProfile,
  listMusic,
  upsertMusic,
  deleteMusic,
  getStoragePaths
} from './settings'
import { clearJobs, createJob, deleteJob, getJob, listJobs, resetJob, updateJob } from './db'
import { worker } from './worker'
import { parseScript } from './pipeline/parser'
import { ttsHealth, listVoices } from './pipeline/tts'
import { extractScriptsFromDocument, sniffVideoName } from './pipeline/document'
import { templateCount, clearTemplates } from './pipeline/templates'
import { pickStorySet, STORY_SETS } from './pipeline/storycards'
import { buildStoryIntroOutroCard } from './pipeline/claude'
import { scaffoldProject, renderHyperframes } from './pipeline/hyperframes'

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

  ipcMain.handle(IPC.MUSIC_LIST, () => listMusic())
  ipcMain.handle(IPC.MUSIC_UPSERT, (_e, raw: { id?: string; name: string; path: string }) => {
    if (!raw?.name?.trim()) throw new Error('Music name is required.')
    if (!raw?.path?.trim()) throw new Error('Music file path is required.')
    return upsertMusic({ id: raw.id, name: raw.name, path: raw.path })
  })
  ipcMain.handle(IPC.MUSIC_DELETE, (_e, id: string) => deleteMusic(id))

  ipcMain.handle(IPC.JOB_ENQUEUE, (_e, args: { script_yaml: string; music_path?: string }) => {
    const spec = parseScript(args.script_yaml)
    const job = createJob({
      video_name: spec.video_name,
      script_yaml: args.script_yaml,
      music_path: args.music_path || undefined
    })
    broadcast({ type: 'created', job })
    worker.wake()
    return job
  })

  ipcMain.handle(IPC.JOB_ENQUEUE_FILE, async (_e, filePath: string, musicPath?: string) => {
    const yaml = await fs.promises.readFile(filePath, 'utf8')
    const spec = parseScript(yaml)
    const job = createJob({
      video_name: spec.video_name,
      script_yaml: yaml,
      script_path: filePath,
      music_path: musicPath || undefined
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
    async (_e, filePath: string, musicPath?: string): Promise<DocumentEnqueueResult> => {
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
            script_path: filePath,
            music_path: musicPath || undefined
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
  ipcMain.handle(IPC.JOB_CLEAR, async () => {
    // Clear the in-app job history. Settings, API keys, voice profiles, and
    // learned templates are stored elsewhere and are untouched. Exported videos
    // in the user's output folder are NOT deleted — only the per-job intermediate
    // render folders under the app workspace are cleaned up.
    const { removed, keptRunning } = clearJobs()
    const { workspace } = getStoragePaths()
    for (const job of removed) {
      broadcast({ type: 'removed', job })
      try {
        await fs.promises.rm(path.join(workspace, job.id), { recursive: true, force: true })
      } catch {
        // best-effort cleanup of temp render files
      }
    }
    return { ok: true, removed: removed.length, keptRunning }
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

  ipcMain.handle(IPC.PICK_AUDIO, async () => {
    const win = getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    // Parent-less dialog if the window isn't available, so the picker still opens.
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
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

  // ---- Fast intro/outro DESIGN PREVIEW -----------------------------------
  // Renders ONLY the story template card for the given part — no ElevenLabs,
  // no Claude, no music, no captions. Duration is estimated from the
  // voiceover word count so the timings resemble the real video. Costs zero
  // API credits and finishes in ~30s; opens the preview mp4's folder when done.
  ipcMain.handle(
    IPC.PREVIEW_CARD,
    async (_e, args: { script_yaml: string; part: 'intro' | 'outro' }): Promise<{ ok: boolean; message: string; path?: string }> => {
      try {
        const spec = parseScript(args.script_yaml)
        const io = args.part === 'intro' ? spec.intro : spec.outro
        if (!io) return { ok: false, message: `The script has no ${args.part} section.` }
        if (!io.scene1 || !io.scene2) {
          return { ok: false, message: `The ${args.part} has no scene1/scene2 — the story template preview needs both.` }
        }

        // Estimate the voiceover duration (~2.4 words/sec, clamped 6–14s).
        const words = io.voiceover.trim().split(/\s+/).filter(Boolean).length
        const durationSeconds = Math.min(14, Math.max(6, words / 2.4))

        // Same set + image resolution logic as the runner.
        const availableImageSets = STORY_SETS.filter((s) => s.assetMode === 'image')
          .filter((s) => {
            const dir = path.join(getStoragePaths().userData, 'template-assets', `set-${s.id}`)
            const slots = s.imageSlots!
            return (
              fs.existsSync(path.join(dir, slots.intro1)) &&
              fs.existsSync(path.join(dir, slots.intro2)) &&
              fs.existsSync(path.join(dir, slots.outro1))
            )
          })
          .map((s) => s.id)
        const storySet = pickStorySet(spec.video_name, spec.template_set, availableImageSets)

        let images: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>> | undefined
        const assetCopies: { src: string; name: string }[] = []
        if (storySet.assetMode === 'image') {
          const assetDir = path.join(getStoragePaths().userData, 'template-assets', `set-${storySet.id}`)
          const slots = storySet.imageSlots!
          const needed: ('intro1' | 'intro2' | 'outro1' | 'outro2')[] =
            args.part === 'intro' ? ['intro1', 'intro2'] : ['outro1', 'outro2']
          images = {}
          for (const slot of needed) {
            const full = path.join(assetDir, slots[slot])
            if (fs.existsSync(full)) {
              images[slot] = `assets/${slots[slot]}`
              assetCopies.push({ src: full, name: slots[slot] })
            } else if (slot !== 'outro2' && !storySet.svgFallbackOk) {
              return { ok: false, message: `Template image missing: ${full} — add the PNG and preview again.` }
            }
          }
        }

        const html = await buildStoryIntroOutroCard({
          kind: args.part,
          scene1: io.scene1,
          scene2: io.scene2,
          badge: spec.channel,
          subscribe: args.part === 'outro' ? !!io.subscribe : false,
          durationSeconds,
          set: storySet,
          images
        })

        const previewDir = path.join(getStoragePaths().workspace, `preview-${randomUUID().slice(0, 8)}`)
        const projectDir = path.join(previewDir, 'project')
        await scaffoldProject(projectDir, html)
        for (const a of assetCopies) {
          await fs.promises.copyFile(a.src, path.join(projectDir, 'assets', a.name))
        }
        const out = path.join(previewDir, `${args.part}_set${storySet.id}_preview.mp4`)
        const settings = getSettings()
        await renderHyperframes({ command: settings.hyperframes_command, projectDir, outputMp4: out, onLog: () => {} })
        shell.showItemInFolder(out)
        return {
          ok: true,
          message: `Preview rendered with set ${storySet.id} "${storySet.name}" (${durationSeconds.toFixed(1)}s, silent — design check only).`,
          path: out
        }
      } catch (err: any) {
        return { ok: false, message: `Preview failed: ${err?.message ?? err}` }
      }
    }
  )

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
