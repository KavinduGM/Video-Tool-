import { useEffect, useState } from 'react'

type PreviewStatus = { text: string; done: boolean; ok?: boolean; path?: string }
// Module-level so the status survives switching tabs (the page unmounts, the
// preview keeps running in the main process, and the latest event is restored
// on remount).
let lastPreviewStatus: PreviewStatus | null = null

export default function NewJobPage({ onQueued }: { onQueued: () => void }): JSX.Element {
  const [yaml, setYaml] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [music, setMusic] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewStatus | null>(lastPreviewStatus)
  const previewBusy = !!preview && !preview.done

  useEffect(() => {
    window.api.template.get().then((t) => setTemplate(t))
    const unsub = window.api.preview?.onEvent?.((ev) => {
      lastPreviewStatus = ev
      setPreview(ev)
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const musicArg = () => music ?? undefined

  const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

  function onMusicDrop(e: React.DragEvent) {
    e.preventDefault()
    setError(null)
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    // Electron 32 removed File.path — resolve via the preload's webUtils helper,
    // falling back to .path for older Electron.
    const p = window.api.getPathForFile?.(f) || (f as unknown as { path?: string }).path || ''
    if (!p) {
      setError('Could not read the dropped file path — use the “Choose file” button instead.')
      return
    }
    if (!AUDIO_RE.test(p)) {
      setError('Please drop an audio file (mp3, wav, m4a, aac, ogg, or flac).')
      return
    }
    setMusic(p)
  }

  async function pickMusic() {
    setError(null)
    if (typeof window.api?.dialog?.pickAudio !== 'function') {
      setError(
        'Audio picker not loaded yet. Fully quit the app and run it again (stop and restart "npm run dev") — the file picker lives in the preload script, which only updates on a full restart, not a hot reload.'
      )
      return
    }
    try {
      const file = await window.api.dialog.pickAudio()
      if (file) setMusic(file)
    } catch (err: any) {
      setError('Could not open the audio picker: ' + (err?.message ?? String(err)))
    }
  }

  async function previewCard(part: 'intro' | 'outro') {
    setError(null)
    setOk(null)
    if (!yaml.trim()) {
      setError('Paste a script first — the preview reads the ' + part + " section's scene1/scene2 and template_set.")
      return
    }
    if (typeof window.api?.preview?.card !== 'function') {
      setError('Preview not loaded yet. Fully quit and restart the app ("npm run dev") — preview lives in the preload script, which only updates on a full restart.')
      return
    }
    const starting: PreviewStatus = { text: `Preview ${part}: starting…`, done: false }
    lastPreviewStatus = starting
    setPreview(starting)
    try {
      // Progress + result arrive via the event stream (the banner below);
      // the invoke result is only a fallback if events were missed.
      const res = await window.api.preview.card(yaml, part)
      if (!res.ok && lastPreviewStatus && !lastPreviewStatus.done) {
        const ev: PreviewStatus = { text: res.message, done: true, ok: false }
        lastPreviewStatus = ev
        setPreview(ev)
      }
    } catch (err: any) {
      const ev: PreviewStatus = { text: 'Preview failed: ' + (err?.message ?? String(err)), done: true, ok: false }
      lastPreviewStatus = ev
      setPreview(ev)
    }
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
          <button className="secondary" onClick={() => previewCard('intro')} disabled={busy || previewBusy}>
            {previewBusy ? 'Previewing…' : 'Preview intro'}
          </button>
          <button className="secondary" onClick={() => previewCard('outro')} disabled={busy || previewBusy}>
            {previewBusy ? 'Previewing…' : 'Preview outro'}
          </button>
        </div>
        {preview && (
          <div
            className={`banner ${preview.done ? (preview.ok ? 'ok' : 'err') : ''}`}
            style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <span style={{ flex: 1 }}>{preview.done ? '' : '⏳ '}{preview.text}</span>
            {preview.done && preview.ok && preview.path && (
              <button className="ghost" onClick={() => window.api.shellOpen(preview.path!)}>
                Open video
              </button>
            )}
            {preview.done && (
              <button
                className="ghost"
                onClick={() => {
                  lastPreviewStatus = null
                  setPreview(null)
                }}
              >
                Dismiss
              </button>
            )}
          </div>
        )}
        <div className="hint" style={{ marginTop: 6 }}>
          Preview renders the COMPLETE intro/outro segment — real voiceover, background music,
          template card and karaoke captions — skipping only the middle scenes. Costs a little
          ElevenLabs credit, no Claude credits. The mp4 opens when done (~1 min).
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onMusicDrop}
          style={{
            marginTop: 12,
            padding: 12,
            border: '1px dashed var(--border, #555)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap'
          }}
        >
          <button className="ghost" onClick={pickMusic} disabled={busy}>
            {music ? 'Change background music' : 'Choose file'}
          </button>
          {music ? (
            <span className="meta">
              Override: <span className="mono">{music.split(/[\\/]/).pop()}</span>{' '}
              <button className="ghost" onClick={() => setMusic(null)}>Clear</button>
            </span>
          ) : (
            <span className="hint">
              Background music (optional) — drag &amp; drop an audio file here, or use the button.
              Overrides the Settings default; plays under intro/outro at 5%.
            </span>
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
