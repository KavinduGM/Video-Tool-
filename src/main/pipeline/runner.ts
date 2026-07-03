import fs from 'node:fs'
import path from 'node:path'
import type { Job, JobLogEntry, Transition } from '@shared/types'
import { parseScript, dimensionsForRatio } from './parser'
import {
  generateSceneHtml,
  reviewScene,
  repairSceneHtml,
  adaptTemplateHtml,
  buildStaticIntroOutroCard,
  buildSubscribeOutroCard
} from './claude'
import { computeSceneFeatures, saveTemplate, findBestTemplate } from './templates'
import { generateAudioWithTimestamps, type WordTiming } from './tts'
import { mergeExamTokens, buildAss } from './captions'
import { scaffoldProject, renderHyperframes } from './hyperframes'
import {
  concatScenesWithTransitions,
  extractFrame,
  muxAudioWithVideo,
  mixVoiceWithMusic,
  burnSubtitles,
  probeDurationSeconds,
  sampleInkFractions,
  ensureDir
} from './ffmpeg'
import { analyzeMotion } from './motion'
import { getSettings, findProfileByName, findMusicByName, getStoragePaths } from '../settings'

const MAX_VISUAL_REVIEW_ATTEMPTS = 10
// Stop early if repairs stop reducing the issue count for this many consecutive
// attempts — burning renders/credits on an oscillating fix helps nobody.
const MAX_NO_PROGRESS = 2
// After this many attempts still haven't fixed a scene, stop letting Claude
// re-roll from scratch and instead adapt a proven template (if we have one that
// structurally matches). "More than 5 tries" → kicks in on attempt 6.
const TEMPLATE_FALLBACK_AFTER = 5
// Each segment gets a 1-second held-frame tail (audio padded with silence).
const SCENE_TAIL_SECONDS = 1.0
// Background music level under the intro/outro.
const MUSIC_VOLUME = 0.05
const FADE: Transition = { type: 'fade', duration: 0.5 }

export interface RunnerHandle {
  cancel(): void
}

export interface RunnerCallbacks {
  onProgress(progress: number, step: string): void
  onLog(entry: JobLogEntry): void
}

// A renderable unit: an intro card, a scene, or an outro card.
interface Segment {
  kind: 'intro' | 'scene' | 'outro'
  label: string // "Intro", "Scene 1/3", "Outro"
  dirName: string // "intro", "scene_1", "outro"
  voiceover: string
  explainer: string // scene.explainer OR a synthesized description for intro/outro
  onScreen?: string
  mode: 'scene' | 'intro' | 'outro'
  sceneIndex: number // for scene prompts; 0 for intro/outro
  saveTemplates: boolean // scenes only
  mixMusic: boolean // intro/outro only
  subscribe: boolean // outro only: deterministic SUBSCRIBE button + arrow card
  transitionOut: Transition
}

export async function runJob(job: Job, cb: RunnerCallbacks, handle: { cancelled: boolean }): Promise<string> {
  const settings = getSettings()
  if (!settings.anthropic_api_key) throw new Error('Anthropic API key is missing in Settings.')
  if (!settings.elevenlabs_api_key) {
    throw new Error('ElevenLabs API key is missing in Settings.')
  }

  const spec = parseScript(job.script_yaml)

  const profile = findProfileByName(spec.voice_profile)
  if (!profile) {
    throw new Error(`Voice profile "${spec.voice_profile}" not found. Add it in the Voice Profiles tab.`)
  }

  const dims = dimensionsForRatio(spec.ratio)
  const { workspace } = getStoragePaths()
  const jobWorkDir = path.join(workspace, job.id)
  ensureDir(jobWorkDir)

  // Resolve background music, in priority order:
  //   1. the script's named music profile (background_music: "Name")
  //   2. a per-job override
  //   3. the global default in Settings
  let musicPath = ''
  if (spec.background_music) {
    const mp = findMusicByName(spec.background_music)
    if (mp) {
      musicPath = mp.path
      cb.onLog(info(`Background music: "${spec.background_music}" → ${mp.path}`))
    } else {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Music profile "${spec.background_music}" not found — add it on the Music tab. Falling back to the default.` })
    }
  }
  if (!musicPath) musicPath = job.music_path || settings.background_music_path || ''
  const musicExists = !!musicPath && fs.existsSync(musicPath)
  if ((spec.intro || spec.outro) && musicPath && !musicExists) {
    cb.onLog({ ts: Date.now(), level: 'warn', message: `Background music file not found: ${musicPath} — intro/outro will play without music.` })
  }

  // ---- Build the segment list: [intro?] + scenes + [outro?] ----
  const sceneCount = spec.scenes.length
  const introDesc = (kind: 'intro' | 'outro', onScreen: string) =>
    `Professional TYPOGRAPHIC ${kind} title card on a SOLID LIGHT background with bold sans-serif text (not hand-drawn, not black). The following on-screen text must all be visible and readable, each line clear, with key words highlighted by a rounded accent block:\n${onScreen}`

  const segments: Segment[] = []
  if (spec.intro) {
    segments.push({
      kind: 'intro', label: 'Intro', dirName: 'intro',
      voiceover: spec.intro.voiceover, explainer: introDesc('intro', spec.intro.on_screen),
      onScreen: spec.intro.on_screen, mode: 'intro', sceneIndex: 0, saveTemplates: false,
      mixMusic: true, subscribe: false, transitionOut: FADE
    })
  }
  spec.scenes.forEach((s, i) => {
    segments.push({
      kind: 'scene', label: `Scene ${i + 1}/${sceneCount}`, dirName: `scene_${i + 1}`,
      voiceover: s.voiceover, explainer: s.explainer, mode: 'scene', sceneIndex: i,
      saveTemplates: true, mixMusic: false, subscribe: false, transitionOut: s.transition_out
    })
  })
  if (spec.outro) {
    // The segment just before the outro fades into it.
    if (segments.length > 0) segments[segments.length - 1].transitionOut = FADE
    segments.push({
      kind: 'outro', label: 'Outro', dirName: 'outro',
      voiceover: spec.outro.voiceover, explainer: introDesc('outro', spec.outro.on_screen),
      onScreen: spec.outro.on_screen, mode: 'outro', sceneIndex: 0, saveTemplates: false,
      mixMusic: true, subscribe: !!spec.outro.subscribe, transitionOut: { type: 'none', duration: 0 }
    })
  }

  const totalSegments = segments.length
  // Roughly: 60% segments (split equally), 30% concat, 10% finalize.
  const segShare = 0.6 / totalSegments

  const results: {
    finalMp4: string
    durationSeconds: number
    transitionOut: Transition
    words: WordTiming[] | null
  }[] = []

  // The intro's final HTML becomes a proven template for the outro (same style).
  let introHtml: string | null = null

  for (let s = 0; s < segments.length; s++) {
    if (handle.cancelled) throw new Error('Cancelled')
    const seg = segments[s]
    const templateHtml = seg.kind === 'outro' && introHtml ? introHtml : undefined
    const res = await produceSegment(seg, s * segShare, templateHtml)
    if (seg.kind === 'intro') introHtml = res.html
    results.push({
      finalMp4: res.finalMp4,
      durationSeconds: res.durationSeconds,
      transitionOut: res.transitionOut,
      words: res.words
    })
  }

  cb.onLog(info(`All ${totalSegments} segment(s) saved. Beginning final concatenation…`))
  if (handle.cancelled) throw new Error('Cancelled')
  cb.onProgress(0.7, 'Concatenating segments')

  ensureDir(spec.output_folder)
  const safeName = spec.video_name.replace(/[\\/:*?"<>|]/g, '_')
  const finalPath = uniquePath(path.join(spec.output_folder, `${safeName}.mp4`))

  // Captions are burned onto the concatenated video, so with captions on we
  // concat to a temp file first, then burn subtitles into the final output.
  const captionsEnabled = spec.captions !== false
  const segmentsWithWords = results.filter((r) => r.words && r.words.length > 0).length
  const doCaptions = captionsEnabled && segmentsWithWords > 0
  const concatOut = doCaptions ? path.join(jobWorkDir, 'concat.mp4') : finalPath

  await concatScenesWithTransitions(
    {
      scenes: results.map((r) => ({
        videoPath: r.finalMp4,
        durationSeconds: r.durationSeconds,
        transitionOut: r.transitionOut
      })),
      out: concatOut,
      width: dims.width,
      height: dims.height,
      fps: 30
    },
    (line) => cb.onLog(info(`ffmpeg: ${line}`))
  )

  if (doCaptions) {
    // Each segment's word times are relative to its own audio. Compute every
    // segment's start offset within the final video, replicating the concat
    // math: a fade/dissolve OVERLAPS the two adjacent segments, so each
    // transition shortens the timeline by its duration.
    cb.onProgress(0.85, 'Burning captions')
    if (segmentsWithWords < results.length) {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Captions: ${results.length - segmentsWithWords} segment(s) had no word timings and will show no captions.` })
    }
    const captionSegments: { units: ReturnType<typeof mergeExamTokens>; offset: number }[] = []
    let cum = 0
    for (let i = 0; i < results.length; i++) {
      let offset = 0
      if (i === 0) {
        offset = 0
        cum = results[0].durationSeconds
      } else {
        const trans = results[i - 1].transitionOut
        const fade =
          trans.type !== 'none'
            ? Math.min(trans.duration, results[i].durationSeconds, cum)
            : 0
        offset = cum - fade
        cum = cum + results[i].durationSeconds - fade
      }
      const words = results[i].words
      if (words && words.length > 0) {
        captionSegments.push({ units: mergeExamTokens(words), offset })
      }
    }
    const assPath = path.join(jobWorkDir, 'captions.ass')
    await fs.promises.writeFile(assPath, buildAss(captionSegments), 'utf8')
    cb.onLog(info(`Captions: burning karaoke captions (${captionSegments.reduce((n, s) => n + s.units.length, 0)} word unit(s)) into the final video`))
    try {
      await burnSubtitles(
        { videoIn: concatOut, assDir: jobWorkDir, assFile: 'captions.ass', out: finalPath },
        (line) => cb.onLog(info(`ffmpeg: ${line}`))
      )
    } catch (err: any) {
      // Never lose the video because of captions — ship the uncaptioned cut.
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Captions burn failed (${err.message}) — saving the video without captions.` })
      await fs.promises.copyFile(concatOut, finalPath)
    }
  }

  cb.onProgress(1, 'Done')
  cb.onLog(info(`Saved final video to ${finalPath}`))
  return finalPath

  // ================================================================
  // Produce one segment: audio → (music mix) → generate → review /
  // surgical-repair loop → mux with tail. Returns its final clip.
  // ================================================================
  async function produceSegment(
    seg: Segment,
    baseProgress: number,
    templateHtml?: string
  ): Promise<{
    finalMp4: string
    durationSeconds: number
    transitionOut: Transition
    html: string
    words: WordTiming[] | null
  }> {
    const segDir = path.join(jobWorkDir, seg.dirName)
    ensureDir(segDir)
    const projectDir = path.join(segDir, 'hyperframes')

    // --- Voiceover audio ---
    cb.onProgress(baseProgress + segShare * 0.0, `${seg.label}: generating audio`)
    cb.onLog(info(`${seg.label}: generating audio with ElevenLabs Turbo v2 (voice=${profile!.name})`))
    const audioPath = path.join(segDir, 'audio.mp3')
    const tts = await generateAudioWithTimestamps(
      { apiKey: settings.elevenlabs_api_key },
      { text: seg.voiceover, profile: profile!, speedOverride: spec.voice_speed, outPath: audioPath }
    )
    if (tts.words) {
      cb.onLog(info(`${seg.label}: got word timings for ${tts.words.length} word(s) — captions will cover this segment`))
    } else {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: no word timings (${tts.note ?? 'unknown'}) — captions will skip this segment.` })
    }
    const audioDuration = await probeDurationSeconds(audioPath)
    cb.onLog(info(`${seg.label}: audio is ${audioDuration.toFixed(2)}s`))
    if (handle.cancelled) throw new Error('Cancelled')

    // --- Background music mix (intro/outro only) ---
    let audioForMux = audioPath
    if (seg.mixMusic && musicExists) {
      const mixedPath = path.join(segDir, 'audio-mixed.mp3')
      cb.onLog(info(`${seg.label}: mixing background music at ${Math.round(MUSIC_VOLUME * 100)}%`))
      try {
        await mixVoiceWithMusic(
          { voiceIn: audioPath, musicIn: musicPath, out: mixedPath, musicVolume: MUSIC_VOLUME, durationSeconds: audioDuration },
          (line) => cb.onLog(info(`ffmpeg: ${line}`))
        )
        audioForMux = mixedPath
      } catch (err: any) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: music mix failed (${err.message}) — using voiceover only.` })
      }
    }

    // --- Deterministic BRANDED SUBSCRIBE OUTRO (system-drawn, no AI) ---
    // When outro.subscribe is set, compose the outro ourselves: the on-screen
    // text + a SUBSCRIBE button + a red down arrow, with a controlled one-pass
    // reveal. It always renders correctly and can never loop, so we skip the
    // Claude generation + review loop entirely.
    if (seg.kind === 'outro' && seg.subscribe) {
      cb.onProgress(baseProgress + segShare * 0.35, `${seg.label}: composing branded subscribe outro`)
      cb.onLog(info(`${seg.label}: composing a deterministic subscribe outro (SUBSCRIBE button + down arrow) — reliable, no AI generation`))
      const html = await buildSubscribeOutroCard(seg.onScreen ?? '', audioDuration)
      await scaffoldProject(projectDir, html)
      if (handle.cancelled) throw new Error('Cancelled')
      const rawMp4 = path.join(segDir, 'render_cta.mp4')
      cb.onProgress(baseProgress + segShare * 0.5, `${seg.label}: rendering with Hyperframes`)
      await renderHyperframes({
        command: settings.hyperframes_command,
        projectDir,
        outputMp4: rawMp4,
        onLog: (line) => cb.onLog(info(`hyperframes: ${line}`))
      })
      const finalMp4 = path.join(segDir, 'segment.mp4')
      cb.onProgress(baseProgress + segShare * 0.85, `${seg.label}: muxing audio + ${SCENE_TAIL_SECONDS}s tail`)
      await muxAudioWithVideo(
        { videoIn: rawMp4, audioIn: audioForMux, out: finalMp4, durationSeconds: audioDuration, tailHoldSeconds: SCENE_TAIL_SECONDS },
        (line) => cb.onLog(info(`ffmpeg: ${line}`))
      )
      const totalSeconds = audioDuration + SCENE_TAIL_SECONDS
      cb.onLog(info(`✓ ${seg.label} saved (${totalSeconds.toFixed(2)}s, branded subscribe outro) → ${finalMp4}`))
      return { finalMp4, durationSeconds: totalSeconds, transitionOut: seg.transitionOut, html, words: tts.words }
    }

    // Render one HTML to its own mp4 and review the final frame → issue list.
    async function renderAndReview(htmlStr: string, tag: string, idx: number): Promise<{ mp4: string; issues: string[]; reviewed: boolean }> {
      await scaffoldProject(projectDir, htmlStr)
      if (handle.cancelled) throw new Error('Cancelled')
      const mp4 = path.join(segDir, `render_${idx}.mp4`)
      cb.onProgress(baseProgress + segShare * 0.4, `${tag}: rendering with Hyperframes`)
      await renderHyperframes({
        command: settings.hyperframes_command,
        projectDir,
        outputMp4: mp4,
        onLog: (line) => cb.onLog(info(`hyperframes: ${line}`))
      })
      if (handle.cancelled) throw new Error('Cancelled')

      try {
        const renderDuration = await probeDurationSeconds(mp4)
        const diff = renderDuration - audioDuration
        if (Math.abs(diff) > 0.5) {
          cb.onLog(info(`${tag}: WARNING — rendered ${renderDuration.toFixed(2)}s vs audio ${audioDuration.toFixed(2)}s (diff ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}s).`))
        }
      } catch {
        /* non-fatal */
      }

      // --- MOTION AUDIT (deterministic, sees the whole timeline) ---
      let motionIssues: string[] = []
      cb.onProgress(baseProgress + segShare * 0.55, `${tag}: motion audit`)
      try {
        const inks = await sampleInkFractions({ videoIn: mp4, count: 16, durationSeconds: audioDuration, workDir: segDir }, () => {})
        const verdict = analyzeMotion(inks)
        motionIssues = verdict.issues
        if (verdict.issues.length > 0) {
          cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: motion audit found ${verdict.loop ? 'LOOPING/FLICKER' : ''}${verdict.loop && verdict.allAtOnce ? ' + ' : ''}${verdict.allAtOnce ? 'NO-STAGGER (all at once)' : ''}.` })
        } else if (!verdict.blank) {
          cb.onLog(info(`${tag}: motion audit OK — progressive reveal, no looping.`))
        }
      } catch (err: any) {
        cb.onLog(info(`${tag}: motion audit skipped (${err.message}).`))
      }

      cb.onProgress(baseProgress + segShare * 0.6, `${tag}: visual review (frame extraction)`)
      const framePath = path.join(segDir, `review_${idx}.jpg`)
      const grabAt = Math.max(0.1, audioDuration - 0.05)
      let visionIssues: string[] = []
      let reviewed = false
      try {
        await extractFrame({ videoIn: mp4, atSeconds: grabAt, out: framePath, quality: 3 }, (line) => cb.onLog(info(`ffmpeg: ${line}`)))
        cb.onProgress(baseProgress + segShare * 0.65, `${tag}: visual review (Claude vision)`)
        const review = await reviewScene({
          apiKey: settings.anthropic_api_key,
          model: settings.claude_model,
          framePath,
          explainer: seg.explainer,
          ratio: spec.ratio
        })
        visionIssues = review.pass ? [] : review.issues
        reviewed = true
      } catch (err: any) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: visual review failed (${err.message}) — relying on the motion audit for this render.` })
      }

      const issues = [...motionIssues, ...visionIssues]
      return { mp4, issues, reviewed: reviewed || motionIssues.length > 0 }
    }

    // Attempt 1 — either adapt the intro card as a template (outro), or generate.
    cb.onProgress(baseProgress + segShare * 0.2, `${seg.label}: composing HTML with Claude`)
    let firstHtml: string | null = null
    if (templateHtml) {
      cb.onLog(info(`${seg.label}: adapting the proven intro card as a template (changing only the text) instead of designing from scratch`))
      const adapted = await adaptTemplateHtml({
        apiKey: settings.anthropic_api_key,
        model: settings.claude_model,
        templateHtml,
        explainer: seg.explainer,
        ratio: spec.ratio,
        durationSeconds: audioDuration
      })
      for (const line of adapted.log) cb.onLog(info(`${seg.label}: ${line}`))
      if (adapted.applied > 0) firstHtml = adapted.html
      else cb.onLog(info(`${seg.label}: template adaptation produced no edits — generating fresh instead.`))
    }
    if (!firstHtml) {
      cb.onLog(info(`${seg.label}: asking Claude (${settings.claude_model}) for HTML`))
      const gen = await generateSceneHtml({
        apiKey: settings.anthropic_api_key,
        model: settings.claude_model,
        ratio: spec.ratio,
        durationSeconds: audioDuration,
        sceneIndex: seg.sceneIndex,
        totalScenes: sceneCount,
        explainer: seg.explainer,
        voiceover: seg.voiceover,
        style: seg.mode === 'scene' ? spec.style : undefined,
        mode: seg.mode,
        onScreen: seg.onScreen
      })
      for (const line of gen.validationLog) cb.onLog(info(`${seg.label}: ${line}`))
      if (gen.validationStatus === 'failed-after-retries') {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: animation-coverage validation failed after ${gen.attempts} attempts — proceeding with best output.` })
      }
      if (gen.safeZone === 'force-fitted') {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: content exceeded the 9:16 safe zone — applied a deterministic geometric fit.` })
      }
      if (gen.sanitized.length > 0) cb.onLog(info(`${seg.label}: sanitized ${gen.sanitized.length} looping construct(s).`))
      firstHtml = gen.html
    }

    const sceneFeatures = computeSceneFeatures(spec.ratio, seg.explainer)

    const first = await renderAndReview(firstHtml, `${seg.label} attempt 1/${MAX_VISUAL_REVIEW_ATTEMPTS}`, 1)
    let best = { html: firstHtml, mp4: first.mp4, issues: first.issues }
    let attempt = 1
    let noProgress = 0
    let templateTried = false

    if (best.issues.length === 0) {
      cb.onLog(info(`${seg.label}: visual review PASSED ✓ on first render`))
      if (seg.saveTemplates && first.reviewed) {
        try {
          const total = saveTemplate(
            { features: sceneFeatures, html: best.html, videoName: spec.video_name, explainerPreview: seg.explainer },
            Date.now()
          )
          cb.onLog(info(`${seg.label}: saved as a reusable template (${sceneFeatures.kind}, ${sceneFeatures.lineCount} line(s)); library now holds ${total}.`))
        } catch (err: any) {
          cb.onLog(info(`${seg.label}: could not save template — ${err.message}`))
        }
      }
    } else {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label} attempt 1: ${best.issues.length} issue(s):` })
      for (const issue of best.issues) cb.onLog({ ts: Date.now(), level: 'warn', message: `  • ${issue}` })
    }

    while (attempt < MAX_VISUAL_REVIEW_ATTEMPTS && best.issues.length > 0 && !handle.cancelled) {
      attempt++

      // Template fallback (scenes only) after >5 failed attempts.
      if (seg.saveTemplates && attempt > TEMPLATE_FALLBACK_AFTER && !templateTried) {
        templateTried = true
        const tag = `${seg.label} template ${attempt}/${MAX_VISUAL_REVIEW_ATTEMPTS}`
        const match = findBestTemplate(sceneFeatures)
        if (!match) {
          cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: no matching proven template available yet — continuing with targeted repairs.` })
        } else {
          cb.onProgress(baseProgress + segShare * 0.2, `${tag}: adapting a proven template`)
          cb.onLog(info(`${tag}: ${best.issues.length} issue(s) unresolved after ${attempt - 1} attempts — adapting a proven "${match.template.videoName}" template instead of re-designing.`))
          const adapted = await adaptTemplateHtml({
            apiKey: settings.anthropic_api_key,
            model: settings.claude_model,
            templateHtml: match.template.html,
            explainer: seg.explainer,
            ratio: spec.ratio,
            durationSeconds: audioDuration
          })
          for (const line of adapted.log) cb.onLog(info(`${tag}: ${line}`))
          if (adapted.applied === 0) {
            cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: could not adapt the template — continuing with repairs.` })
          } else {
            const tr = await renderAndReview(adapted.html, tag, attempt)
            if (tr.issues.length === 0) {
              cb.onLog(info(`${tag}: visual review PASSED ✓ (proven template adapted)`))
              best = { html: adapted.html, mp4: tr.mp4, issues: [] }
              break
            }
            if (tr.issues.length < best.issues.length) {
              cb.onLog(info(`${tag}: template improved the scene — issues ${best.issues.length} → ${tr.issues.length}; continuing from the template version`))
              best = { html: adapted.html, mp4: tr.mp4, issues: tr.issues }
              noProgress = 0
            } else {
              cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: adapted template did not beat the current best — keeping the previous best.` })
            }
          }
          continue
        }
      }

      const tag = `${seg.label} repair ${attempt}/${MAX_VISUAL_REVIEW_ATTEMPTS}`
      cb.onProgress(baseProgress + segShare * 0.2, `${tag}: targeted fix (${best.issues.length} issue(s))`)
      cb.onLog(info(`${tag}: requesting surgical edits for ${best.issues.length} issue(s) — patching only the affected parts, not a full rewrite`))

      const repaired = await repairSceneHtml({
        apiKey: settings.anthropic_api_key,
        model: settings.claude_model,
        html: best.html,
        issues: best.issues,
        explainer: seg.explainer,
        ratio: spec.ratio,
        durationSeconds: audioDuration
      })
      for (const line of repaired.log) cb.onLog(info(`${tag}: ${line}`))

      if (repaired.applied === 0) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: no edits could be applied — keeping the current best and stopping repairs.` })
        break
      }

      const rr = await renderAndReview(repaired.html, tag, attempt)
      if (rr.issues.length === 0) {
        cb.onLog(info(`${tag}: visual review PASSED ✓ (resolved with ${repaired.applied} targeted edit(s), no full rewrite)`))
        best = { html: repaired.html, mp4: rr.mp4, issues: [] }
        break
      }
      if (rr.issues.length < best.issues.length) {
        cb.onLog(info(`${tag}: progress — issues ${best.issues.length} → ${rr.issues.length}; keeping this version`))
        best = { html: repaired.html, mp4: rr.mp4, issues: rr.issues }
        noProgress = 0
        for (const issue of rr.issues) cb.onLog({ ts: Date.now(), level: 'warn', message: `  • still: ${issue}` })
      } else {
        noProgress++
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: this repair did not reduce issues (${best.issues.length} → ${rr.issues.length}) — discarding it and keeping the previous best.` })
        if (noProgress >= MAX_NO_PROGRESS) {
          cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: no progress for ${MAX_NO_PROGRESS} attempts — stopping to save renders/credits.` })
          break
        }
      }
    }

    // STATIC FALLBACK (intro/outro only). If the animated card still has issues
    // after every attempt (e.g. it loops or drops lines), ship a guaranteed-clean
    // STATIC card instead — the on-screen text held for the whole duration, which
    // physically cannot loop. A calm static card always beats a broken animated one.
    if ((seg.kind === 'intro' || seg.kind === 'outro') && best.issues.length > 0 && seg.onScreen) {
      cb.onLog({
        ts: Date.now(),
        level: 'warn',
        message: `${seg.label}: animated version still had issues after ${attempt} attempt(s) — falling back to a clean STATIC title card (no animation) so nothing loops or drops.`
      })
      try {
        const staticHtml = await buildStaticIntroOutroCard(seg.onScreen, audioDuration)
        await scaffoldProject(projectDir, staticHtml)
        if (handle.cancelled) throw new Error('Cancelled')
        const staticMp4 = path.join(segDir, 'render_static.mp4')
        await renderHyperframes({
          command: settings.hyperframes_command,
          projectDir,
          outputMp4: staticMp4,
          onLog: (line) => cb.onLog(info(`hyperframes: ${line}`))
        })
        best = { html: staticHtml, mp4: staticMp4, issues: [] }
        cb.onLog(info(`${seg.label}: static card rendered — all lines visible and held for the full duration.`))
      } catch (err: any) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: static fallback failed (${err.message}) — using the best animated version.` })
      }
    }

    if (best.issues.length > 0) {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `${seg.label}: shipping the best version (fewest issues) after ${attempt} attempt(s). Remaining issue(s):` })
      for (const issue of best.issues) cb.onLog({ ts: Date.now(), level: 'warn', message: `  • ${issue}` })
    }

    // Mux audio (voiceover, or voice+music for intro/outro) + held-frame tail.
    cb.onProgress(baseProgress + segShare * 0.85, `${seg.label}: muxing audio + ${SCENE_TAIL_SECONDS}s tail`)
    const finalMp4 = path.join(segDir, 'segment.mp4')
    await muxAudioWithVideo(
      { videoIn: best.mp4, audioIn: audioForMux, out: finalMp4, durationSeconds: audioDuration, tailHoldSeconds: SCENE_TAIL_SECONDS },
      (line) => cb.onLog(info(`ffmpeg: ${line}`))
    )
    const totalSeconds = audioDuration + SCENE_TAIL_SECONDS
    cb.onLog(info(`✓ ${seg.label} saved (${totalSeconds.toFixed(2)}s, ${attempt} review attempt${attempt === 1 ? '' : 's'}) → ${finalMp4}`))

    return { finalMp4, durationSeconds: totalSeconds, transitionOut: seg.transitionOut, html: best.html, words: tts.words }
  }
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p
  const parsed = path.parse(p)
  let i = 2
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${i})${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
    i++
  }
}

function info(message: string): JobLogEntry {
  return { ts: Date.now(), level: 'info', message }
}
