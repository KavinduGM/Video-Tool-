import { useEffect, useState } from 'react'

export default function NewJobPage({ onQueued }: { onQueued: () => void }): JSX.Element {
  const [yaml, setYaml] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [music, setMusic] = useState<string | null>(null)

  useEffect(() => {
    window.api.template.get().then((t) => setTemplate(t))
  }, [])

  const musicArg = () => music ?? undefined

  async function pickMusic() {
    const file = await window.api.dialog.pickAudio()
    if (file) setMusic(file)
  }

  async function enqueueText() {
    setError(null)
    setOk(null)
    if (!yaml.trim()) {
      setError('Paste a script first.')
      return
    }
    setBusy(true)
    try {
      const job = await window.api.jobs.enqueue(yaml, musicArg())
      setOk(`Queued: ${job.video_name}`)
      setYaml('')
      setTimeout(onQueued, 300)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function enqueueFromFiles() {
    setError(null)
    setOk(null)
    const files = await window.api.dialog.pickScripts()
    if (files.length === 0) return
    setBusy(true)
    const queued: string[] = []
    const failed: string[] = []
    for (const f of files) {
      try {
        const job = await window.api.jobs.enqueueFile(f, musicArg())
        queued.push(job.video_name)
      } catch (err: any) {
        failed.push(`${f}: ${err?.message ?? err}`)
      }
    }
    setBusy(false)
    if (queued.length) setOk(`Queued ${queued.length}: ${queued.join(', ')}`)
    if (failed.length) setError(failed.join('\n'))
    if (queued.length) setTimeout(onQueued, 400)
  }

  async function enqueueFromDocument() {
    setError(null)
    setOk(null)
    const file = await window.api.dialog.pickDocument()
    if (!file) return
    setBusy(true)
    try {
      const { queued, errors, total } = await window.api.jobs.enqueueDocument(file, musicArg())
      if (queued.length > 0) {
        setOk(
          `Queued ${queued.length} of ${total} script(s) from the document: ${queued
            .map((j) => j.video_name)
            .join(', ')}. Videos will render one at a time.`
        )
      }
      if (errors.length > 0) {
        setError(
          `${errors.length} of ${total} script(s) failed to parse and were skipped:\n` +
            errors
              .map(
                (e) =>
                  `  • Script #${e.index}${e.videoName ? ` (${e.videoName})` : ''}: ${e.message}`
              )
              .join('\n')
        )
      }
      if (queued.length > 0) setTimeout(onQueued, 600)
    } catch (err: any) {
      // Whole-document failure (file unreadable, no scripts found, etc.)
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>New job</h2>
      <div className="sub">
        Paste a single script, pick one or more <span className="code-inline">.yml</span> files,
        or upload a <span className="code-inline">.md</span> document that bundles several scripts
        (in <span className="code-inline">```yaml</span> fenced blocks, or separated by{' '}
        <span className="code-inline">---</span> lines). Every queued job renders sequentially.
      </div>

      {error && <div className="banner err">{error}</div>}
      {ok && <div className="banner ok">{ok}</div>}

      <div className="card">
        <h3>Script</h3>
        <textarea
          spellCheck={false}
          value={yaml}
          placeholder="Paste your YAML script here…"
          onChange={(e) => setYaml(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={enqueueText} disabled={busy}>
            {busy ? 'Queuing…' : 'Queue this script'}
          </button>
          <button className="secondary" onClick={enqueueFromFiles} disabled={busy}>
            Pick file(s) and queue
          </button>
          <button className="secondary" onClick={enqueueFromDocument} disabled={busy}>
            Import .md document
          </button>
          <button
            className="ghost"
            onClick={() => setYaml(template)}
            disabled={!template}
          >
            Load template
          </button>
        </div>
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="ghost" onClick={pickMusic} disabled={busy}>
            {music ? 'Change background music' : 'Background music (optional)'}
          </button>
          {music ? (
            <span className="meta">
              Override: <span className="mono">{music.split(/[\\/]/).pop()}</span>{' '}
              <button className="ghost" onClick={() => setMusic(null)}>Clear</button>
            </span>
          ) : (
            <span className="hint">Overrides the Settings default for these job(s). Plays under intro/outro at 5%.</span>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Template</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          Save this as <span className="code-inline">my-video.yml</span> and edit per video. The exact format the parser expects.
        </div>
        <pre className="logs" style={{ maxHeight: 360 }}>
          {template || '(loading…)'}
        </pre>
      </div>
    </>
  )
}
