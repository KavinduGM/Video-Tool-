// Pure-JS, file-backed persistent job queue. No native modules.
//
// All jobs live in memory; every mutation persists the full array to disk
// with an atomic write-then-rename so we never corrupt the file on crash.
// Single-process / single-writer (the Electron main process), so we don't
// need a mutex — JS is single-threaded and every public function here is
// synchronous between read and write.

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Job, JobLogEntry, JobStatus } from '@shared/types'
import { getStoragePaths } from './settings'

interface DbShape {
  version: 1
  jobs: Job[]
}

let cache: DbShape | null = null
let dbPath: string | null = null

function init(): DbShape {
  if (cache) return cache
  const paths = getStoragePaths()
  fs.mkdirSync(paths.userData, { recursive: true })
  fs.mkdirSync(paths.workspace, { recursive: true })
  dbPath = paths.db

  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8')
      const parsed = JSON.parse(raw) as DbShape
      if (parsed && parsed.version === 1 && Array.isArray(parsed.jobs)) {
        cache = parsed
      } else {
        cache = { version: 1, jobs: [] }
      }
    } catch {
      // Corrupt JSON — back it up and start fresh rather than losing the app.
      try {
        fs.renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
      } catch {
        // ignore
      }
      cache = { version: 1, jobs: [] }
    }
  } else {
    cache = { version: 1, jobs: [] }
  }

  // Recover from a crash: anything that was 'running' goes back to 'queued'.
  let dirty = false
  for (const j of cache.jobs) {
    if (j.status === 'running') {
      j.status = 'queued'
      j.current_step = undefined
      j.progress = 0
      dirty = true
    }
  }
  if (dirty) persist()
  return cache
}

function persist(): void {
  if (!cache || !dbPath) return
  const tmp = `${dbPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
  // fs.renameSync is atomic on the same volume on both Windows and POSIX,
  // but Windows fails if the dest exists. Use renameSync after unlink as fallback.
  try {
    fs.renameSync(tmp, dbPath)
  } catch {
    try {
      fs.unlinkSync(dbPath)
    } catch {
      // ignore
    }
    fs.renameSync(tmp, dbPath)
  }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function createJob(input: {
  video_name: string
  script_yaml: string
  script_path?: string
}): Job {
  const db = init()
  const now = Date.now()
  const job: Job = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    status: 'queued',
    script_yaml: input.script_yaml,
    script_path: input.script_path,
    video_name: input.video_name,
    progress: 0,
    logs: []
  }
  db.jobs.push(job)
  persist()
  return deepClone(job)
}

export function listJobs(): Job[] {
  const db = init()
  return db.jobs
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .map((j) => deepClone(j))
}

export function getJob(id: string): Job | null {
  const db = init()
  const j = db.jobs.find((x) => x.id === id)
  return j ? deepClone(j) : null
}

export function nextQueuedJob(): Job | null {
  const db = init()
  const queued = db.jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.created_at - b.created_at)
  return queued[0] ? deepClone(queued[0]) : null
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, 'status' | 'progress' | 'current_step' | 'error' | 'output_path'>>
): Job | null {
  const db = init()
  const idx = db.jobs.findIndex((j) => j.id === id)
  if (idx < 0) return null
  const existing = db.jobs[idx]
  const next: Job = {
    ...existing,
    ...patch,
    updated_at: Date.now()
  }
  db.jobs[idx] = next
  persist()
  return deepClone(next)
}

export function appendLog(id: string, entry: JobLogEntry): Job | null {
  const db = init()
  const idx = db.jobs.findIndex((j) => j.id === id)
  if (idx < 0) return null
  const j = db.jobs[idx]
  j.logs = [...j.logs, entry].slice(-500)
  j.updated_at = Date.now()
  persist()
  return deepClone(j)
}

export function deleteJob(id: string): void {
  const db = init()
  const before = db.jobs.length
  db.jobs = db.jobs.filter((j) => j.id !== id)
  if (db.jobs.length !== before) persist()
}

export function resetJob(id: string): Job | null {
  return updateJob(id, {
    status: 'queued',
    progress: 0,
    current_step: undefined,
    error: undefined,
    output_path: undefined
  })
}
