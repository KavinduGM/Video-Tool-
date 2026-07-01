import fs from 'node:fs'
import path from 'node:path'
import type { Job, JobLogEntry } from '@shared/types'
import { parseScript, dimensionsForRatio } from './parser'
import { generateSceneHtml, reviewScene, repairSceneHtml, adaptTemplateHtml } from './claude'
import { computeSceneFeatures, saveTemplate, findBestTemplate } from './templates'
import { generateAudio } from './tts'
import { scaffoldProject, renderHyperframes } from './hyperframes'
import {
  concatScenesWithTransitions,
  extractFrame,
  muxAudioWithVideo,
  probeDurationSeconds,
  ensureDir
} from './ffmpeg'
import { getSettings, findProfileByName, getStoragePaths } from '../settings'

const MAX_VISUAL_REVIEW_ATTEMPTS = 10
// Stop early if repairs stop reducing the issue count for this many consecutive
// attempts — burning renders/credits on an oscillating fix helps nobody.
const MAX_NO_PROGRESS = 2
// After this many attempts still haven't fixed a scene, stop letting Claude
// re-roll from scratch and instead adapt a proven template (if we have one that
// structurally matches). "More than 5 tries" → kicks in on attempt 6.
const TEMPLATE_FALLBACK_AFTER = 5

export interface RunnerHandle {
  cancel(): void
}

export interface RunnerCallbacks {
  onProgress(progress: number, step: string): void
  onLog(entry: JobLogEntry): void
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

  const sceneResults: {
    finalMp4: string
    durationSeconds: number
    transition_out: (typeof spec.scenes)[number]['transition_out']
  }[] = []

  const totalScenes = spec.scenes.length
  // Roughly: 60% scenes (split equally), 30% concat, 10% finalize.
  const sceneShare = 0.6 / totalScenes

  // Each scene gets a 1-second tail: the final video frame is held still
  // and the audio is padded with silence. Gives every scene a clean breath
  // before the next one begins (and a clean ending on the very last one).
  const SCENE_TAIL_SECONDS = 1.0

  for (let i = 0; i < spec.scenes.length; i++) {
    if (handle.cancelled) throw new Error('Cancelled')
    const scene = spec.scenes[i]
    const sceneDir = path.join(jobWorkDir, `scene_${i + 1}`)
    ensureDir(sceneDir)
    const baseProgress = i * sceneShare

    cb.onProgress(baseProgress + sceneShare * 0.0, `Scene ${i + 1}/${totalScenes}: generating audio`)
    cb.onLog(info(`Scene ${i + 1}: generating audio with ElevenLabs Turbo v2 (voice=${profile.name})`))
    // ElevenLabs Turbo v2 returns MP3 — hardcode the extension to match.
    const audioPath = path.join(sceneDir, `audio.mp3`)
    await generateAudio(
      { apiKey: settings.elevenlabs_api_key },
      {
        text: scene.voiceover,
        profile,
        speedOverride: spec.voice_speed,
        outPath: audioPath
      }
    )

    const audioDuration = await probeDurationSeconds(audioPath)
    cb.onLog(info(`Scene ${i + 1}: audio is ${audioDuration.toFixed(2)}s`))
    if (handle.cancelled) throw new Error('Cancelled')

    // ---------- Generate → render → visual-review → SURGICAL REPAIR loop ----------
    // Attempt 1 generates the full HTML. After that, instead of regenerating the
    // whole scene (which is expensive and tends to introduce brand-new issues
    // while fixing one), we ask Claude for MINIMAL find/replace edits targeting
    // only the reviewer's issues, and apply them deterministically — the rest of
    // the HTML stays byte-for-byte identical. We keep the version with the FEWEST
    // issues and DISCARD any repair that regresses, so a fix can never make the
    // scene worse. Up to MAX_VISUAL_REVIEW_ATTEMPTS, stopping early on a clean
    // pass or when repairs stop making progress.
    const projectDir = path.join(sceneDir, 'hyperframes')

    // Render one HTML to its own mp4 and review the final frame → issue list.
    async function renderAndReview(
      htmlStr: string,
      tag: string,
      idx: number
    ): Promise<{ mp4: string; issues: string[]; reviewed: boolean }> {
      await scaffoldProject(projectDir, htmlStr)
      if (handle.cancelled) throw new Error('Cancelled')
      const mp4 = path.join(sceneDir, `render_${idx}.mp4`)
      cb.onProgress(baseProgress + sceneShare * 0.4, `${tag}: rendering with Hyperframes`)
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

      cb.onProgress(baseProgress + sceneShare * 0.6, `${tag}: visual review (frame extraction)`)
      const framePath = path.join(sceneDir, `review_${idx}.jpg`)
      const grabAt = Math.max(0.1, audioDuration - 0.05)
      try {
        await extractFrame({ videoIn: mp4, atSeconds: grabAt, out: framePath, quality: 3 }, (line) => cb.onLog(info(`ffmpeg: ${line}`)))
      } catch (err: any) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: frame extraction failed (${err.message}) — accepting this render.` })
        return { mp4, issues: [], reviewed: false }
      }

      cb.onProgress(baseProgress + sceneShare * 0.65, `${tag}: visual review (Claude vision)`)
      try {
        const review = await reviewScene({
          apiKey: settings.anthropic_api_key,
          model: settings.claude_model,
          framePath,
          explainer: scene.explainer,
          ratio: spec.ratio
        })
        return { mp4, issues: review.pass ? [] : review.issues, reviewed: true }
      } catch (err: any) {
        cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: visual review call failed (${err.message}) — accepting this render.` })
        return { mp4, issues: [], reviewed: false }
      }
    }

    // Attempt 1 — full generation.
    cb.onProgress(baseProgress + sceneShare * 0.2, `Scene ${i + 1}: composing HTML with Claude`)
    cb.onLog(info(`Scene ${i + 1}: asking Claude (${settings.claude_model}) for HTML`))
    const gen = await generateSceneHtml({
      apiKey: settings.anthropic_api_key,
      model: settings.claude_model,
      ratio: spec.ratio,
      durationSeconds: audioDuration,
      sceneIndex: i,
      totalScenes,
      explainer: scene.explainer,
      voiceover: scene.voiceover,
      style: spec.style
    })
    for (const line of gen.validationLog) cb.onLog(info(`Scene ${i + 1}: ${line}`))
    if (gen.validationStatus === 'failed-after-retries') {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Scene ${i + 1}: animation-coverage validation failed after ${gen.attempts} attempts — proceeding with best output.` })
    }
    if (gen.safeZone === 'force-fitted') {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Scene ${i + 1}: content exceeded the 9:16 safe zone — applied a deterministic geometric fit.` })
    }
    if (gen.sanitized.length > 0) {
      cb.onLog(info(`Scene ${i + 1}: sanitized ${gen.sanitized.length} looping construct(s).`))
    }

    const sceneFeatures = computeSceneFeatures(spec.ratio, scene.explainer)

    const first = await renderAndReview(gen.html, `Scene ${i + 1} attempt 1/${MAX_VISUAL_REVIEW_ATTEMPTS}`, 1)
    let best = { html: gen.html, mp4: first.mp4, issues: first.issues }
    let attempt = 1
    let noProgress = 0
    let templateTried = false

    if (best.issues.length === 0) {
      cb.onLog(info(`Scene ${i + 1}: visual review PASSED ✓ on first render`))
      // First-try pass = a proven composition. Bank it as a reusable template.
      if (first.reviewed) {
        try {
          const total = saveTemplate(
            {
              features: sceneFeatures,
              html: gen.html,
              videoName: spec.video_name,
              explainerPreview: scene.explainer
            },
            Date.now()
          )
          cb.onLog(info(`Scene ${i + 1}: saved as a reusable template (${sceneFeatures.kind}, ${sceneFeatures.lineCount} line(s)); library now holds ${total}.`))
        } catch (err: any) {
          cb.onLog(info(`Scene ${i + 1}: could not save template — ${err.message}`))
        }
      }
    } else {
      cb.onLog({ ts: Date.now(), level: 'warn', message: `Scene ${i + 1} attempt 1: ${best.issues.length} issue(s):` })
      for (const issue of best.issues) cb.onLog({ ts: Date.now(), level: 'warn', message: `  • ${issue}` })
    }

    while (attempt < MAX_VISUAL_REVIEW_ATTEMPTS && best.issues.length > 0 && !handle.cancelled) {
      attempt++

      // ---- Template fallback ----
      // After >5 attempts still failing, stop re-rolling and adapt a proven
      // template (one that passed on its first try and structurally matches).
      // Try it once; if it beats the current best, adopt it and keep going.
      if (attempt > TEMPLATE_FALLBACK_AFTER && !templateTried) {
        templateTried = true
        const tag = `Scene ${i + 1} template ${attempt}/${MAX_VISUAL_REVIEW_ATTEMPTS}`
        const match = findBestTemplate(sceneFeatures)
        if (!match) {
          cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: no matching proven template available yet — continuing with targeted repairs.` })
        } else {
          cb.onProgress(baseProgress + sceneShare * 0.2, `${tag}: adapting a proven template`)
          cb.onLog(info(`${tag}: ${best.issues.length} issue(s) unresolved after ${attempt - 1} attempts — adapting a proven "${match.template.videoName}" template (${match.template.features.kind}, ${match.template.features.lineCount} line(s)) instead of re-designing.`))
          const adapted = await adaptTemplateHtml({
            apiKey: settings.anthropic_api_key,
            model: settings.claude_model,
            templateHtml: match.template.html,
            explainer: scene.explainer,
            ratio: spec.ratio,
            durationSeconds: audioDuration
          })
          for (const line of adapted.log) cb.onLog(info(`${tag}: ${line}`))
          if (adapted.applied === 0) {
            cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: could not adapt the template (no edits applied) — continuing with repairs.` })
          } else {
            const tr = await renderAndReview(adapted.html, tag, attempt)
            if (tr.issues.length === 0) {
              cb.onLog(info(`${tag}: visual review PASSED ✓ (proven template adapted to this scene)`))
              best = { html: adapted.html, mp4: tr.mp4, issues: [] }
              break
            }
            if (tr.issues.length < best.issues.length) {
              cb.onLog(info(`${tag}: template improved the scene — issues ${best.issues.length} → ${tr.issues.length}; continuing repairs from the template version`))
              best = { html: adapted.html, mp4: tr.mp4, issues: tr.issues }
              noProgress = 0
            } else {
              cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: adapted template did not beat the current best (${best.issues.length} → ${tr.issues.length}) — keeping the previous best.` })
            }
          }
          continue // template attempt consumed this slot
        }
      }

      const tag = `Scene ${i + 1} repair ${attempt}/${MAX_VISUAL_REVIEW_ATTEMPTS}`
      cb.onProgress(baseProgress + sceneShare * 0.2, `${tag}: targeted fix (${best.issues.length} issue(s))`)
      cb.onLog(info(`${tag}: requesting surgical edits for ${best.issues.length} issue(s) — patching only the affected parts, not a full rewrite`))

      const repaired = await repairSceneHtml({
        apiKey: settings.anthropic_api_key,
        model: settings.claude_model,
        html: best.html,
        issues: best.issues,
        explainer: scene.explainer,
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
        // Regression or stall — DISCARD this repair, keep the known-good best.
        noProgress++
        cb.onLog({
          ts: Date.now(),
          level: 'warn',
          message: `${tag}: this repair did not reduce issues (${best.issues.length} → ${rr.issues.length}) — discarding it and keeping the previous best so no new problems are introduced.`
        })
        if (noProgress >= MAX_NO_PROGRESS) {
          cb.onLog({ ts: Date.now(), level: 'warn', message: `${tag}: no progress for ${MAX_NO_PROGRESS} attempts — stopping to save renders/credits.` })
          break
        }
      }
    }

    if (best.issues.length > 0) {
      cb.onLog({
        ts: Date.now(),
        level: 'warn',
        message: `Scene ${i + 1}: shipping the best version (fewest issues) after ${attempt} attempt(s). Remaining issue(s):`
      })
      for (const issue of best.issues) cb.onLog({ ts: Date.now(), level: 'warn', message: `  • ${issue}` })
    }

    const rawMp4 = best.mp4

    // Mux audio + 1s held-frame tail into the final scene MP4
    cb.onProgress(
      baseProgress + sceneShare * 0.85,
      `Scene ${i + 1}/${totalScenes}: muxing audio + ${SCENE_TAIL_SECONDS}s tail`
    )
    const finalMp4 = path.join(sceneDir, 'scene.mp4')
    await muxAudioWithVideo(
      {
        videoIn: rawMp4,
        audioIn: audioPath,
        out: finalMp4,
        durationSeconds: audioDuration,
        tailHoldSeconds: SCENE_TAIL_SECONDS
      },
      (line) => cb.onLog(info(`ffmpeg: ${line}`))
    )
    const sceneTotalSeconds = audioDuration + SCENE_TAIL_SECONDS
    cb.onLog(info(
      `✓ Scene ${i + 1}/${totalScenes} saved (${audioDuration.toFixed(2)}s audio + ${SCENE_TAIL_SECONDS.toFixed(1)}s held-frame tail = ${sceneTotalSeconds.toFixed(2)}s, ${attempt} review attempt${attempt === 1 ? '' : 's'}) → ${finalMp4}`
    ))

    sceneResults.push({
      finalMp4,
      durationSeconds: sceneTotalSeconds,
      transition_out: scene.transition_out
    })
  }

  cb.onLog(info(`All ${totalScenes} scene MP4(s) saved. Beginning final concatenation…`))

  if (handle.cancelled) throw new Error('Cancelled')
  cb.onProgress(0.7, 'Concatenating scenes')
  cb.onLog(info('Concatenating all scenes with transitions'))

  ensureDir(spec.output_folder)
  const safeName = spec.video_name.replace(/[\\/:*?"<>|]/g, '_')
  const finalPath = uniquePath(path.join(spec.output_folder, `${safeName}.mp4`))

  await concatScenesWithTransitions(
    {
      scenes: sceneResults.map((s) => ({
        videoPath: s.finalMp4,
        durationSeconds: s.durationSeconds,
        transitionOut: s.transition_out
      })),
      out: finalPath,
      width: dims.width,
      height: dims.height,
      fps: 30
    },
    (line) => cb.onLog(info(`ffmpeg: ${line}`))
  )

  cb.onProgress(1, 'Done')
  cb.onLog(info(`Saved final video to ${finalPath}`))

  // Optional: clean intermediate workspace on success — keep for now for debugging.
  return finalPath
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
