import { useState } from 'react'
import type { Job } from '../../../shared/types'

export default function QueuePage({ jobs }: { jobs: Job[] }): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedJob = jobs.find((j) => j.id === selected) ?? null
  const clearableCount = jobs.filter((j) => j.status !== 'running').length

  async function clearHistory() {
    if (
      !confirm(
        'Clear the job history? This removes the job list and their temporary render files.\n\n' +
          'Your settings, API keys, voice profiles, and any exported videos on disk are NOT affected. ' +
          'A currently running job is kept.'
      )
    )
      return
    await window.api.jobs.clearHistory()
  }

  return (
    <>
      <h2>Queue</h2>
      <div className="sub">
        Videos are rendered one at a time, oldest first. Add jobs from the <span className="code-inline">New job</span> tab.
      </div>

      {clearableCount > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="danger" onClick={clearHistory}>
            Clear history ({clearableCount})
          </button>
        </div>
      )}

      {jobs.length === 0 && (
        <div className="card">
          <div className="muted">No jobs yet — head to “New job” to add one.</div>
        </div>
      )}

      {jobs.map((j) => (
        <div className="job" key={j.id}>
          <div>
            <div className="title-row">
              <span className={`tag ${j.status}`}>{j.status}</span>
              <span className="name">{j.video_name}</span>
            </div>
            <div className="step">
              {j.current_step ?? (j.status === 'completed' ? 'Done' : '—')}
              {j.error && <span className="muted"> — {j.error}</span>}
            </div>
            <div className="progress">
              <div style={{ width: `${Math.round((j.progress || 0) * 100)}%` }} />
            </div>
          </div>
          <div className="actions">
            <button className="ghost" onClick={() => setSelected(j.id)}>Details</button>
            {(j.status === 'queued' || j.status === 'running') && (
              <button className="danger" onClick={() => window.api.jobs.cancel(j.id)}>
                Cancel
              </button>
            )}
            {(j.status === 'failed' || j.status === 'cancelled') && (
              <button className="secondary" onClick={() => window.api.jobs.retry(j.id)}>
                Retry
              </button>
            )}
            {j.status === 'completed' && j.output_path && (
              <button className="secondary" onClick={() => window.api.shellOpen(j.output_path!)}>
                Show file
              </button>
            )}
            {j.status !== 'running' && (
              <button className="ghost" onClick={() => window.api.jobs.remove(j.id)}>
                Remove
              </button>
            )}
          </div>
        </div>
      ))}

      {selectedJob && (
        <JobDetails job={selectedJob} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

function JobDetails({ job, onClose }: { job: Job; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{job.video_name}</h3>
        <div className="kv" style={{ marginBottom: 14 }}>
          <div className="k">Status</div><div><span className={`tag ${job.status}`}>{job.status}</span></div>
          <div className="k">Step</div><div>{job.current_step ?? '—'}</div>
          <div className="k">Progress</div><div>{Math.round((job.progress || 0) * 100)}%</div>
          {job.output_path && <><div className="k">Output</div><div className="mono">{job.output_path}</div></>}
          {job.error && <><div className="k">Error</div><div style={{ color: 'var(--danger)' }}>{job.error}</div></>}
        </div>
        <h3>Logs</h3>
        <div className="logs">
          {job.logs.length === 0 && <span className="muted">(no logs yet)</span>}
          {job.logs.slice(-300).map((l, i) => (
            <div key={i} className={l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : ''}>
              {new Date(l.ts).toLocaleTimeString()} — {l.message}
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
