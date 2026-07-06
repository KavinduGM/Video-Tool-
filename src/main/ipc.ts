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
import { pickStorySet, STORY_SETS, setsForChannel, templateAssetDir } from './pipeline/storycards'
import { buildStoryIntroOutroCard } from './pipeline/claude'
import { scaffoldProject, renderHyperframes } from './pipeline/hyperframes'
import { generateAudioWithTimestamps } from './pipeline/tts'
import { probeDurationSeconds, mixVoiceWithMusic, muxAudioWithVideo, burnSubtitles, trimPngAlpha, MUSIC_VOLUME } from './pipeline/ffmpeg'
import { mergeExamTokens, buildAss } from './pipeline/captions'
import { findProfileByName, findMusicByName } from './settings'
import {
  splitConcepts,
  buildScriptPrompt,
  generateScript,
  validateGeneratedScript,
  reviewScriptWithClaude,
  factoryVideoName
} from './pipeline/factory'

// Full-frame design backgrounds (storyboard without texts) — mirror of the
// runner's BG_SLOTS; a card's *_bg.png wins over its hero slot.
const BG_SLOTS: Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string> = {
  intro1: 'intro1_bg.png',
  intro2: 'intro2_bg.png',
  outro1: 'outro1_bg.png',
  outro2: 'outro2_bg.png'
}

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

  // Approve a needs-review script (optionally with the user's edits) → queue.
  ipcMain.handle(
    IPC.JOB_APPROVE,
    (_e, args: { id: string; script_yaml?: string }): { ok: boolean; reason?: string } => {
      const job = getJob(args.id)
      if (!job) return { ok: false, reason: 'Job not found.' }
      if (job.status !== 'review') return { ok: false, reason: `Job is ${job.status}, not awaiting review.` }
      let yaml = args.script_yaml ?? job.script_yaml
      let videoName = job.video_name
      try {
        const spec = parseScript(yaml)
        videoName = spec.video_name
      } catch (err: any) {
        return { ok: false, reason: `Script still doesn't validate: ${err?.message ?? err}` }
      }
      const updated = updateJob(args.id, {
        script_yaml: yaml,
        video_name: videoName,
        status: 'queued',
        error: undefined,
        current_step: undefined,
        progress: 0
      })
      if (updated) {
        broadcast({ type: 'updated', job: updated })
        worker.wake()
      }
      return { ok: true }
    }
  )

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

  // ---- COMPLETE intro/outro PREVIEW (no middle scenes) -------------------
  // Produces the REAL segment(s) exactly as a full job would: ElevenLabs
  // voiceover with word timings, music at 10%, the story template card at the
  // true audio duration, held-frame tail, burned karaoke captions. part:
  // 'intro' | 'outro' render one card for the picked set; 'all' renders BOTH
  // cards for EVERY set whose design files are uploaded (voiceovers are
  // synthesized once and reused across all sets).
  ipcMain.handle(
    IPC.PREVIEW_CARD,
    async (_e, args: { script_yaml: string; part: 'intro' | 'outro' | 'all' }): Promise<{ ok: boolean; message: string; path?: string }> => {
      const send = (text: string, extra: { done?: boolean; ok?: boolean; path?: string } = {}) =>
        getMainWindow()?.webContents.send(IPC.PREVIEW_EVENT, { text, done: false, ...extra })
      const fail = (message: string) => {
        send(message, { done: true, ok: false })
        return { ok: false, message }
      }
      try {
        const settings = getSettings()
        const spec = parseScript(args.script_yaml)
        send(`Preview ${args.part}: reading the script…`)
        const profile = findProfileByName(spec.voice_profile)
        if (!profile) {
          return fail(`Voice profile "${spec.voice_profile}" not found — create it on the Voice Profiles page.`)
        }

        const previewDir = path.join(getStoragePaths().workspace, `preview-${randomUUID().slice(0, 8)}`)
        fs.mkdirSync(previewDir, { recursive: true })

        type CardPart = 'intro' | 'outro'
        type PreparedAudio = {
          io: NonNullable<typeof spec.intro>
          durationSeconds: number
          audioForMux: string
          words: Awaited<ReturnType<typeof generateAudioWithTimestamps>>['words']
        }

        // Voiceover + music per part — synthesized ONCE, reused across sets.
        const prepAudio = async (part: CardPart): Promise<PreparedAudio> => {
          const io = part === 'intro' ? spec.intro : spec.outro
          if (!io) throw new Error(`The script has no ${part} section.`)
          if (!io.scene1 || !io.scene2) throw new Error(`The ${part} has no scene1/scene2 — the story template preview needs both.`)
          send(`Preview: generating the ${part} voiceover with ElevenLabs…`)
          const audioPath = path.join(previewDir, `audio-${part}.mp3`)
          const tts = await generateAudioWithTimestamps(
            { apiKey: settings.elevenlabs_api_key },
            { text: io.voiceover, profile, speedOverride: spec.voice_speed, outPath: audioPath }
          )
          const durationSeconds = await probeDurationSeconds(audioPath)
          let audioForMux = audioPath
          const musicPath = spec.background_music
            ? findMusicByName(spec.background_music)?.path
            : settings.background_music_path
          if (musicPath && fs.existsSync(musicPath)) {
            try {
              const mixed = path.join(previewDir, `audio-${part}-mixed.mp3`)
              await mixVoiceWithMusic({ voiceIn: audioPath, musicIn: musicPath, out: mixed, musicVolume: MUSIC_VOLUME, durationSeconds })
              audioForMux = mixed
            } catch {
              /* keep plain voiceover */
            }
          }
          return { io, durationSeconds, audioForMux, words: tts.words }
        }

        // Per-set, per-part asset resolution (never throws — reports missing).
        const resolveAssets = (storySet: (typeof STORY_SETS)[number], part: CardPart) => {
          const images: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>> = {}
          const backdrops: Partial<Record<'intro1' | 'intro2' | 'outro1' | 'outro2', string>> = {}
          const copies: { src: string; name: string; trim: boolean }[] = []
          const missing: string[] = []
          if (storySet.assetMode === 'image') {
            const assetDir = templateAssetDir(spec.channel, storySet.id)
            const slots = storySet.imageSlots!
            const needed: ('intro1' | 'intro2' | 'outro1' | 'outro2')[] =
              part === 'intro' ? ['intro1', 'intro2'] : ['outro1', 'outro2']
            for (const slot of needed) {
              const bgFull = path.join(assetDir, BG_SLOTS[slot])
              if (fs.existsSync(bgFull)) {
                backdrops[slot] = `assets/${BG_SLOTS[slot]}`
                copies.push({ src: bgFull, name: BG_SLOTS[slot], trim: false })
                continue
              }
              const full = path.join(assetDir, slots[slot])
              if (fs.existsSync(full)) {
                images[slot] = `assets/${slots[slot]}`
                copies.push({ src: full, name: slots[slot], trim: true })
              } else if (slot !== 'outro2' && !storySet.svgFallbackOk) {
                missing.push(full)
              }
            }
          }
          return { images, backdrops, copies, missing }
        }

        // A set has REAL uploaded designs when its bg triple or hero triple exists.
        const hasRealUploads = (storySet: (typeof STORY_SETS)[number]): boolean => {
          const dir = templateAssetDir(spec.channel, storySet.id)
          const slots = storySet.imageSlots!
          const heroes = ['intro1', 'intro2', 'outro1'].every((k) =>
            fs.existsSync(path.join(dir, slots[k as 'intro1' | 'intro2' | 'outro1']))
          )
          const bgs = ['intro1', 'intro2', 'outro1'].every((k) =>
            fs.existsSync(path.join(dir, BG_SLOTS[k as 'intro1' | 'intro2' | 'outro1']))
          )
          return heroes || bgs
        }

        const renderCard = async (
          storySet: (typeof STORY_SETS)[number],
          part: CardPart,
          a: PreparedAudio,
          outName: string
        ): Promise<string> => {
          const res = resolveAssets(storySet, part)
          if (res.missing.length > 0) throw new Error(`template image missing: ${res.missing[0]}`)
          const html = await buildStoryIntroOutroCard({
            kind: part,
            scene1: a.io.scene1!,
            scene2: a.io.scene2!,
            badge: spec.exam_name || spec.channel,
            subscribe: part === 'outro' ? !!a.io.subscribe : false,
            durationSeconds: a.durationSeconds,
            set: storySet,
            images: res.images,
            backdrops: res.backdrops
          })
          const projectDir = path.join(previewDir, `proj-${outName}`)
          await scaffoldProject(projectDir, html)
          for (const c of res.copies) {
            if (c.trim) await trimPngAlpha({ src: c.src, dest: path.join(projectDir, 'assets', c.name) })
            else await fs.promises.copyFile(c.src, path.join(projectDir, 'assets', c.name))
          }
          const raw = path.join(previewDir, `raw-${outName}.mp4`)
          await renderHyperframes({ command: settings.hyperframes_command, projectDir, outputMp4: raw, onLog: () => {} })
          const muxed = path.join(previewDir, `mux-${outName}.mp4`)
          await muxAudioWithVideo({
            videoIn: raw,
            audioIn: a.audioForMux,
            out: muxed,
            durationSeconds: a.durationSeconds,
            tailHoldSeconds: part === 'intro' ? 0.35 : 1.0
          })
          let finalOut = path.join(previewDir, `${outName}.mp4`)
          if (spec.captions !== false && a.words && a.words.length > 0) {
            const assFile = `cap-${outName}.ass`
            await fs.promises.writeFile(path.join(previewDir, assFile), buildAss([{ units: mergeExamTokens(a.words), offset: 0 }]), 'utf8')
            try {
              await burnSubtitles({ videoIn: muxed, assDir: previewDir, assFile, out: finalOut })
            } catch {
              finalOut = muxed
            }
          } else {
            finalOut = muxed
          }
          return finalOut
        }

        // ---------------- ALL SETS: batch intro+outro per uploaded set ----------------
        if (args.part === 'all') {
          const aIntro = await prepAudio('intro')
          const aOutro = await prepAudio('outro')
          const rendered: number[] = []
          const skipped: string[] = []
          const channelSets = setsForChannel(spec.channel)
          for (const st of channelSets) {
            if (!hasRealUploads(st)) {
              skipped.push(`set ${st.id} (${st.name})`)
              continue
            }
            const nn = String(st.id).padStart(2, '0')
            send(`Preview ALL: set ${st.id} "${st.name}" — rendering intro (${rendered.length * 2 + 1}/${channelSets.length * 2} max)…`)
            await renderCard(st, 'intro', aIntro, `set-${nn}-intro`)
            send(`Preview ALL: set ${st.id} "${st.name}" — rendering outro…`)
            await renderCard(st, 'outro', aOutro, `set-${nn}-outro`)
            rendered.push(st.id)
          }
          await shell.openPath(previewDir)
          const message =
            `Preview ALL done: rendered intro+outro for ${rendered.length} set(s) [${rendered.join(', ')}]` +
            (skipped.length ? ` — skipped (no design files uploaded yet): ${skipped.join(', ')}` : '') +
            `. Files are named set-NN-intro.mp4 / set-NN-outro.mp4.`
          send(message, { done: true, ok: rendered.length > 0, path: previewDir })
          return { ok: rendered.length > 0, message, path: previewDir }
        }

        // ---------------- SINGLE PART: picked set, as before ----------------
        const a = await prepAudio(args.part)
        const availableImageSets = setsForChannel(spec.channel)
          .filter((st) => st.assetMode === 'image')
          .filter(hasRealUploads)
          .map((st) => st.id)
        const storySet = pickStorySet(spec.video_name, spec.template_set, availableImageSets, spec.channel)
        send(`Preview ${args.part}: rendering the card with Hyperframes (set ${storySet.id} "${storySet.name}", ${a.durationSeconds.toFixed(1)}s — takes ~30–60s)…`)
        const finalOut = await renderCard(storySet, args.part, a, `${args.part}_set${storySet.id}_preview`)
        shell.showItemInFolder(finalOut)
        const message = `Complete ${args.part} preview rendered with set ${storySet.id} "${storySet.name}" (${a.durationSeconds.toFixed(1)}s + tail, voice + music + captions).`
        send(message, { done: true, ok: true, path: finalOut })
        return { ok: true, message, path: finalOut }
      } catch (err: any) {
        return fail(`Preview failed: ${err?.message ?? err}`)
      }
    }
  )

  // ---- SCRIPT FACTORY ----------------------------------------------------
  // channel + exam name + theory document (.txt/.md, --- separated concepts)
  // → one verified script per concept → straight into the render queue.
  // Every script must pass the deterministic format validator AND a Claude
  // quality review; failures regenerate with exact feedback, and anything
  // still failing is reported, never queued.
  ipcMain.handle(
    IPC.FACTORY_GENERATE,
    async (
      _e,
      args: { channel: string; exam_name: string; doc_path: string; voice_profile: string }
    ): Promise<{ ok: boolean; message: string; queued: number; failed: string[] }> => {
      const send = (text: string, extra: { done?: boolean; ok?: boolean } = {}) =>
        getMainWindow()?.webContents.send(IPC.PREVIEW_EVENT, { text, done: false, ...extra })
      const finish = (ok: boolean, message: string, queued: number, failed: string[]) => {
        send(message, { done: true, ok })
        return { ok, message, queued, failed }
      }
      try {
        const settings = getSettings()
        if (!settings.anthropic_api_key) return finish(false, 'Anthropic API key is missing in Settings.', 0, [])
        const examName = args.exam_name.trim()
        if (!examName) return finish(false, 'Exam name is required (e.g. "WGU C310 OA").', 0, [])
        if (!findProfileByName(args.voice_profile)) {
          return finish(false, `Voice profile "${args.voice_profile}" not found.`, 0, [])
        }
        if (/\.docx$/i.test(args.doc_path)) {
          return finish(false, 'Please save the theory document as .txt or .md (docx is not supported yet).', 0, [])
        }
        const text = await fs.promises.readFile(args.doc_path, 'utf8')
        const concepts = splitConcepts(text)
        if (concepts.length === 0) {
          return finish(false, 'No concept sections found — separate concepts with lines containing just "---".', 0, [])
        }
        // Production model: 10 shorts per exam — one per template set (1..10).
        const MAX_CONCEPTS = 10
        const use = concepts.slice(0, MAX_CONCEPTS)
        if (concepts.length > MAX_CONCEPTS) {
          send(`Factory: document has ${concepts.length} concepts — generating the first ${MAX_CONCEPTS}.`)
        }

        // Music rotation from the CURRENT saved profiles — add new audio names
        // on the Music tab and future runs use them automatically.
        const music = listMusic().map((m) => m.name)
        if (music.length === 0) {
          send('Factory: no music profiles saved — scripts will use the global default music.')
        }

        const outputFolder = settings.default_output_folder || 'C:\\VideoTool\\out'

        // Template rotation: short 1 → set 1, short 2 → set 2 … in ORDER,
        // restarting per document — but only across sets whose design files
        // are actually uploaded (a forced set with missing files would lose
        // its design). With all 10 uploaded this is the exact 1..10 mapping.
        const uploadedSets = setsForChannel(args.channel).filter((st) => {
          const dir = templateAssetDir(args.channel, st.id)
          const slots = st.imageSlots!
          const req: ('intro1' | 'intro2' | 'outro1')[] = ['intro1', 'intro2', 'outro1']
          const heroes = req.every((k) => fs.existsSync(path.join(dir, slots[k])))
          const bgs = req.every((k) => fs.existsSync(path.join(dir, BG_SLOTS[k])))
          return heroes || bgs
        })
          .map((st) => st.id)
          .sort((a, b) => a - b)
        if (uploadedSets.length === 0) {
          send('Factory: no template sets have uploaded design files yet — templates will auto-pick fallbacks.')
        } else {
          send(`Factory: rotating templates across uploaded sets [${uploadedSets.join(', ')}] in order.`)
        }

        const queued: string[] = []
        const failed: string[] = []

        for (let i = 0; i < use.length; i++) {
          // Set number baked into the name/filename so the user can see at a
          // glance which template set each short used (NJ_RE_Exam_01_Set1…).
          const tset = uploadedSets.length ? uploadedSets[i % uploadedSets.length] : undefined
          const videoName = tset ? `${factoryVideoName(examName, i)}_Set${tset}` : factoryVideoName(examName, i)
          const target = {
            examName,
            channel: args.channel,
            videoName,
            outputFolder,
            voiceProfile: args.voice_profile,
            backgroundMusic: music.length ? music[i % music.length] : undefined,
            templateSet: tset,
            paletteIndex: i,
            conceptText: use[i]
          }
          const expect = {
            videoName,
            channel: args.channel,
            examName,
            voiceProfile: args.voice_profile,
            backgroundMusic: target.backgroundMusic,
            templateSet: target.templateSet
          }
          const prompt = buildScriptPrompt(target)
          let yaml = ''
          let ok = false
          let lastErrors: string[] = []
          try {
          // up to 3 attempts against the deterministic validator
          for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
            send(`Factory ${i + 1}/${use.length} (${videoName}): writing script (attempt ${attempt})…`)
            yaml = await generateScript({
              apiKey: settings.anthropic_api_key,
              model: settings.claude_model,
              prompt,
              feedback: lastErrors.length ? lastErrors.join('\n') : undefined,
              previousYaml: lastErrors.length && yaml ? yaml : undefined
            })
            const v = validateGeneratedScript(yaml, expect)
            lastErrors = v.errors
            ok = v.errors.length === 0
            if (!ok) send(`Factory ${i + 1}/${use.length}: format check found ${v.errors.length} issue(s) — regenerating with exact feedback.`)
          }
          if (!ok) {
            // Park it for MANUAL review instead of discarding — the user can
            // fix/approve it from the Queue tab.
            const reason = `Format check: ${lastErrors.slice(0, 4).join(' | ')}`
            const rj = createJob({ video_name: videoName, script_yaml: yaml, status: 'review', error: reason })
            updateJob(rj.id, { current_step: 'Needs manual review' })
            broadcast({ type: 'created', job: getJob(rj.id)! })
            failed.push(videoName)
            send(`Factory ${i + 1}/${use.length}: ${videoName} needs YOUR review (Queue tab) — ${lastErrors.length} unresolved issue(s).`)
            continue
          }
          // Claude quality review — one repair round allowed.
          send(`Factory ${i + 1}/${use.length}: reviewing script quality…`)
          let review = await reviewScriptWithClaude({
            apiKey: settings.anthropic_api_key,
            model: settings.claude_model,
            yaml,
            examName,
            conceptText: use[i]
          })
          if (!review.pass) {
            send(`Factory ${i + 1}/${use.length}: reviewer flagged ${review.issues.length} issue(s) — one repair round…`)
            const yaml2 = await generateScript({
              apiKey: settings.anthropic_api_key,
              model: settings.claude_model,
              prompt,
              feedback: review.issues.join('\n'),
              previousYaml: yaml
            })
            const v2 = validateGeneratedScript(yaml2, expect)
            if (v2.errors.length === 0) {
              const review2 = await reviewScriptWithClaude({
                apiKey: settings.anthropic_api_key,
                model: settings.claude_model,
                yaml: yaml2,
                examName,
                conceptText: use[i]
              })
              if (review2.pass) {
                yaml = yaml2
                review = review2
              }
            }
          }
          if (!review.pass) {
            const reason = `AI reviewer: ${review.issues.slice(0, 3).join(' | ')}`
            const rj = createJob({ video_name: videoName, script_yaml: yaml, status: 'review', error: reason })
            updateJob(rj.id, { current_step: 'Needs manual review' })
            broadcast({ type: 'created', job: getJob(rj.id)! })
            failed.push(videoName)
            send(`Factory ${i + 1}/${use.length}: ${videoName} needs YOUR review (Queue tab) — reviewer doubts: ${review.issues[0] ?? ''}`)
            continue
          }
          // Verified → queue for rendering. Wake the worker NOW so rendering
          // starts with the first verified script and runs in parallel with the
          // rest of the generation — a later concept parked for manual review
          // must never hold up videos for scripts that already passed.
          const job = createJob({ video_name: videoName, script_yaml: yaml })
          broadcast({ type: 'created', job })
          queued.push(videoName)
          worker.wake()
          send(`Factory ${i + 1}/${use.length}: ✓ verified and queued ${videoName}.`)
          } catch (err: any) {
            failed.push(videoName)
            if (yaml) {
              const rj = createJob({ video_name: videoName, script_yaml: yaml, status: 'review', error: `Generation error: ${err?.message ?? err}` })
              updateJob(rj.id, { current_step: 'Needs manual review' })
              broadcast({ type: 'created', job: getJob(rj.id)! })
            }
            send(`Factory ${i + 1}/${use.length}: ${videoName} hit an error (${err?.message ?? err}) — continuing with the next concept.`)
          }
        }
        if (queued.length > 0) worker.wake()
        const message =
          `Factory done: ${queued.length}/${use.length} verified and rendering` +
          (failed.length ? ` — ${failed.length} NEED YOUR MANUAL REVIEW in the Queue tab: ${failed.join(', ')}` : '') +
          `.`
        return finish(queued.length > 0 || failed.length > 0, message, queued.length, failed)
      } catch (err: any) {
        return finish(false, `Factory failed: ${err?.message ?? err}`, 0, [])
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
