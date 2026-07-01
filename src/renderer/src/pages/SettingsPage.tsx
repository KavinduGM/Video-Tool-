import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [ttsCheck, setTtsCheck] = useState<{ ok: boolean; detail?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [templateCount, setTemplateCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.templates.count().then(setTemplateCount)
  }, [])

  async function clearTemplates() {
    if (!confirm('Clear all learned scene templates? The app will re-learn them as scenes pass review on the first try.')) return
    await window.api.templates.clear()
    setTemplateCount(0)
  }

  if (!settings) return <div className="muted">Loading…</div>

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings({ ...settings!, [key]: value })
    setSavedMsg(null)
  }

  async function save() {
    const next = await window.api.settings.set(settings!)
    setSettings(next)
    setSavedMsg('Settings saved.')
  }

  async function pickFolder() {
    const folder = await window.api.dialog.pickFolder(settings!.default_output_folder)
    if (folder) update('default_output_folder', folder)
  }

  async function testTts() {
    setChecking(true)
    setTtsCheck(null)
    await window.api.settings.set(settings!)
    const r = await window.api.tts.health()
    setTtsCheck(r)
    setChecking(false)
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="sub">
        Stored in your user data folder. API keys are kept locally — never sent anywhere except the services they belong to.
      </div>

      {savedMsg && <div className="banner ok">{savedMsg}</div>}

      <div className="card">
        <h3>Claude (Anthropic)</h3>
        <div className="row">
          <label className="field grow">
            API key
            <input
              type="password"
              value={settings.anthropic_api_key}
              onChange={(e) => update('anthropic_api_key', e.target.value)}
              placeholder="sk-ant-…"
            />
          </label>
          <label className="field" style={{ width: 220 }}>
            Model
            <input
              type="text"
              value={settings.claude_model}
              onChange={(e) => update('claude_model', e.target.value)}
              placeholder="claude-opus-4-8"
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>ElevenLabs</h3>
        <div className="sub" style={{ marginBottom: 8 }}>
          Voice generation uses the <strong>Turbo v2 (English-only)</strong> model. Get your API key
          from <span className="code-inline">elevenlabs.io → Profile → API Keys</span>, and grab voice IDs
          from <span className="code-inline">Voices → (voice) → ID</span> to plug into Voice profiles.
        </div>
        <div className="row">
          <label className="field grow">
            API key
            <input
              type="password"
              value={settings.elevenlabs_api_key}
              onChange={(e) => update('elevenlabs_api_key', e.target.value)}
              placeholder="sk_…"
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={testTts} disabled={checking}>
            {checking ? 'Checking…' : 'Test connection'}
          </button>
          {ttsCheck && (
            <div className={`banner ${ttsCheck.ok ? 'ok' : 'err'}`} style={{ margin: 0 }}>
              {ttsCheck.ok ? (ttsCheck.detail ?? 'ElevenLabs key OK.') : `Failed: ${ttsCheck.detail}`}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Output and tools</h3>
        <label className="field">
          Default output folder
          <div className="path-row">
            <input
              type="text"
              value={settings.default_output_folder}
              onChange={(e) => update('default_output_folder', e.target.value)}
            />
            <button className="secondary" onClick={pickFolder}>Choose…</button>
          </div>
        </label>
        <label className="field" style={{ marginTop: 12 }}>
          Hyperframes command
          <input
            type="text"
            value={settings.hyperframes_command}
            onChange={(e) => update('hyperframes_command', e.target.value)}
            placeholder="npx hyperframes"
          />
          <span className="hint">
            Usually <span className="code-inline">npx hyperframes</span>. Use an absolute path if Node/npx isn't in PATH.
          </span>
        </label>
      </div>

      <div className="card">
        <h3>Learned scene templates</h3>
        <div className="sub" style={{ marginBottom: 8 }}>
          When a 9:16 scene passes visual review on the first try, its layout is saved as a reusable
          template. If a later scene keeps failing, the app adapts the closest matching template
          instead of re-designing from scratch.
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="meta">
            Saved templates: <span className="mono">{templateCount ?? '…'}</span>
          </div>
          <button className="danger" onClick={clearTemplates} disabled={!templateCount}>
            Clear templates
          </button>
        </div>
      </div>

      <div className="row">
        <button onClick={save}>Save settings</button>
      </div>
    </>
  )
}
