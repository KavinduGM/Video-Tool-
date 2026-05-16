import fs from 'node:fs'
import path from 'node:path'
import type { Job, JobLogEntry } from '@shared/types'
import { parseScript, dimensionsForRatio } from './parser'
import { generateSceneHtml } from './claude'
import { generateAudio } from './tts'
import { scaffoldProject, renderHyperframes } from './hyperframes'
import {
  concatScenesWithTransitions,
  muxAudioWithVideo,
  probeDurationSeconds,
  ensureDir
} from './ffmpeg'
import { getSettings, findProfileByName, getStoragePaths } from '../settings'

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
  if (!settings.tts_base_url || !settings.tts_api_key) {
    throw new Error('TTS base URL or API key is missing in Settings.')
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

  for (let i = 0; i < spec.scenes.length; i++) {
    if (handle.cancelled) throw new Error('Cancelled')
    const scene = spec.scenes[i]
    const sceneDir = path.join(jobWorkDir, `scene_${i + 1}`)
    ensureDir(sceneDir)
    const baseProgress = i * sceneShare

    cb.onProgress(baseProgress + sceneShare * 0.0, `Scene ${i + 1}/${totalScenes}: generating audio`)
    cb.onLog(info(`Scene ${i + 1}: generating audio (voice=${profile.name})`))
    const audioFmt = profile.default_format ?? 'mp3'
    const audioPath = path.join(sceneDir, `audio.${audioFmt}`)
    await generateAudio(
      { baseUrl: settings.tts_base_url, apiKey: settings.tts_api_key },
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

    cb.onProgress(baseProgress + sceneShare * 0.2, `Scene ${i + 1}/${totalScenes}: composing HTML with Claude`)
    cb.onLog(info(`Scene ${i + 1}: asking Claude (${settings.claude_model}) for HTML`))
    const { html, sanitized } = await generateSceneHtml({
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
    if (sanitized.length > 0) {
      cb.onLog(info(`Scene ${i + 1}: sanitized ${sanitized.length} looping construct(s) from Claude's HTML:`))
      for (const note of sanitized) cb.onLog(info(`  - ${note}`))
    }

    const projectDir = path.join(sceneDir, 'hyperframes')
    await scaffoldProject(projectDir, html)
    if (handle.cancelled) throw new Error('Cancelled')

    cb.onProgress(baseProgress + sceneShare * 0.4, `Scene ${i + 1}/${totalScenes}: rendering with Hyperframes`)
    const rawMp4 = path.join(sceneDir, 'render.mp4')
    await renderHyperframes({
      command: settings.hyperframes_command,
      projectDir,
      outputMp4: rawMp4,
      onLog: (line) => cb.onLog(info(`hyperframes: ${line}`))
    })
    if (handle.cancelled) throw new Error('Cancelled')

    cb.onProgress(baseProgress + sceneShare * 0.8, `Scene ${i + 1}/${totalScenes}: muxing audio`)
    const finalMp4 = path.join(sceneDir, 'scene.mp4')
    await muxAudioWithVideo(
      { videoIn: rawMp4, audioIn: audioPath, out: finalMp4, durationSeconds: audioDuration },
      (line) => cb.onLog(info(`ffmpeg: ${line}`))
    )

    sceneResults.push({
      finalMp4,
      durationSeconds: audioDuration,
      transition_out: scene.transition_out
    })
  }

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
