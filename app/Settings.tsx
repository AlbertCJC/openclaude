'use client';
import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Cpu, KeyRound, Plug, Search, ShieldCheck, Trash, Webhook } from 'lucide-react';
import type { Cfg, Provider } from './Providers';

const TABS = [
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'providers', label: 'Providers & keys', icon: KeyRound },
  { id: 'mcp', label: 'MCP servers', icon: Plug },
  { id: 'hooks', label: 'Hooks', icon: Webhook },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
] as const;
export type SettingsTab = typeof TABS[number]['id'];

type Props = { cfg: Cfg; onSave: (c: Partial<Cfg>) => Promise<void>; models: string[]; modelErr: string; tab: SettingsTab; setTab: (t: SettingsTab) => void };

export function Settings({ cfg, onSave, models, modelErr, tab, setTab }: Props) {
  return (
    <div className="settings">
      <nav className="settabs" aria-label="Settings sections">
        <h2>Settings</h2>
        {TABS.map(t => (
          <button key={t.id} className={`navbtn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><t.icon size={16} /> {t.label}</button>
        ))}
      </nav>
      <div className="setbody">
        {tab === 'model' && <ModelTab cfg={cfg} onSave={onSave} models={models} modelErr={modelErr} />}
        {tab === 'providers' && <ProvidersTab cfg={cfg} onSave={onSave} />}
        {tab === 'mcp' && <JsonTab key="mcp" title="MCP servers" value={cfg.mcpServers}
          hint={<>Same shape as Claude Code&apos;s .mcp.json &quot;mcpServers&quot;: {'{"name": {"command": "npx", "args": [...]}}'} or {'{"name": {"url": "https://…"}}'}</>}
          onSave={v => onSave({ mcpServers: v })} />}
        {tab === 'hooks' && <JsonTab key="hooks" title="Hooks" value={cfg.hooks}
          hint="Claude Code settings.json &quot;hooks&quot; format (PreToolUse, PostToolUse, UserPromptSubmit). Commands run on your computer; exit code 2 blocks."
          onSave={v => onSave({ hooks: v as Cfg['hooks'] })} />}
        {tab === 'permissions' && <PermissionsTab cfg={cfg} onSave={onSave} />}
      </div>
    </div>
  );
}

function ModelTab({ cfg, onSave, models, modelErr }: { cfg: Cfg; onSave: Props['onSave']; models: string[]; modelErr: string }) {
  const all = [...cfg.catalog, ...cfg.custom];
  const providerId = cfg.model.split('/')[0];
  const [model, setModel] = useState(cfg.model);
  return (
    <section className="setsec">
      <h3>Model</h3>
      <label className="field">Provider
        <select value={providerId} onChange={e => {
          const m = `${e.target.value}/` + (all.find(p => p.id === e.target.value)?.example.split('/').slice(1).join('/') ?? '');
          setModel(m); onSave({ model: m });
        }}>
          {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field">Model
        <input list="models" className="mono" value={model} onChange={e => setModel(e.target.value)} onBlur={() => model !== cfg.model && onSave({ model })} />
        <datalist id="models">{models.map(m => <option key={m} value={m} />)}</datalist>
      </label>
      <span className="muted">{modelErr ? `Model list unavailable: ${modelErr}` : `${models.length} models available`}</span>
      <label className="field">Reasoning effort
        <select value={cfg.effort} onChange={e => onSave({ effort: e.target.value as Cfg['effort'] })}>
          {['low', 'medium', 'high'].map(x => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label className="field">Web search
        <select value={cfg.search ?? 'auto'} onChange={e => onSave({ search: e.target.value as Cfg['search'] })}>
          <option value="auto">Auto (first provider with a key, then DuckDuckGo)</option>
          <option value="brave">Brave Search</option>
          <option value="tavily">Tavily</option>
          <option value="duckduckgo">DuckDuckGo (no key)</option>
        </select>
      </label>
      <span className="muted">Add Brave or Tavily keys under Providers &amp; keys. DuckDuckGo is always the fallback.</span>
    </section>
  );
}

// Numbered keys (add / remove / reorder); key 1 is used first, the next on auth or rate-limit errors.
function ProvidersTab({ cfg, onSave }: { cfg: Cfg; onSave: Props['onSave'] }) {
  const [keys, setKeys] = useState<Record<string, string[]>>(structuredClone(cfg.keys));
  const [open, setOpen] = useState<string | null>(cfg.model.split('/')[0]);
  const [draft, setDraft] = useState({ id: '', baseURL: '' });
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const list = [...cfg.catalog, ...cfg.custom, ...(cfg.searchCatalog ?? [])];

  const setRow = (p: string, rows: string[]) => {
    const next = { ...keys, [p]: rows };
    setKeys(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave({ keys: Object.fromEntries(Object.entries(next).map(([id, r]) => [id, r.map(x => x.trim()).filter(Boolean)])) });
      setSaved(p);
      setTimeout(() => setSaved(s => (s === p ? null : s)), 1500);
    }, 600);
  };
  const move = (p: string, i: number, d: number) => {
    const r = [...(keys[p] ?? [])];
    if (i + d < 0 || i + d >= r.length) return;
    [r[i], r[i + d]] = [r[i + d], r[i]];
    setRow(p, r);
  };
  const addCustom = () => {
    const id = draft.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!id || !/^https?:\/\//.test(draft.baseURL)) return setErr('Enter an ID and an http(s) base URL.');
    if (list.some(p => p.id === id)) return setErr('That ID is already used.');
    const p: Provider = { id, name: id, baseURL: draft.baseURL.replace(/\/$/, ''), keyName: `${id.toUpperCase()}_API_KEY`, example: `${id}/<model-id>` };
    onSave({ custom: [...cfg.custom, p] });
    setDraft({ id: '', baseURL: '' });
    setErr('');
  };

  return (
    <section className="setsec">
      <h3>Providers &amp; API keys</h3>
      <p className="muted">Keys are stored on this computer only and save automatically. Key 1 is used first; if it fails with an auth or rate-limit error, the next key is tried.</p>
      <div className="row" style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10 }} aria-hidden />
        <input aria-label="Search providers" placeholder="Search providers" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, paddingLeft: 32 }} />
      </div>
      {list.filter(p => (p.name + p.id).toLowerCase().includes(q.toLowerCase())).map(p => {
        const rows = keys[p.id] ?? [];
        const n = rows.filter(Boolean).length;
        return (
          <div key={p.id} className="prov">
            <button className="provhead" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
              <span className="muted">{n ? `${n} key(s)` : p.local ? 'local' : 'not set'}</span>
            </button>
            {open === p.id && (
              <div className="provbody">
                <div className="muted"><code>{p.keyName}</code> · {p.baseURL} · e.g. <code>{p.example}</code>
                  {p.keysUrl && <> · <a href={p.keysUrl} target="_blank" rel="noreferrer">Get a key</a></>}</div>
                {[...rows, ''].map((k, i) => (
                  <div key={i} className="row">
                    <span className="muted" style={{ width: 44 }}>Key {i + 1}</span>
                    {i === rows.length
                      ? <input type="password" aria-label={`${p.name} key ${i + 1}`} value="" style={{ flex: 1 }} autoComplete="off"
                          onChange={e => e.target.value && setRow(p.id, [...rows, e.target.value])} />
                      : <>
                        <input type="password" aria-label={`${p.name} key ${i + 1}`} value={k} style={{ flex: 1 }} autoComplete="off"
                          onChange={e => setRow(p.id, rows.map((x, j) => (j === i ? e.target.value : x)))} />
                        <button onClick={() => move(p.id, i, -1)} aria-label="Move up" className="iconbtn"><ChevronUp size={15} /></button>
                        <button onClick={() => move(p.id, i, 1)} aria-label="Move down" className="iconbtn"><ChevronDown size={15} /></button>
                        <button onClick={() => setRow(p.id, rows.filter((_, j) => j !== i))} aria-label="Remove key" className="iconbtn"><Trash size={15} /></button>
                      </>}
                  </div>
                ))}
                {saved === p.id && <span className="muted ok">Saved</span>}
                {cfg.custom.some(c => c.id === p.id) && <div className="row"><button onClick={() => onSave({ custom: cfg.custom.filter(c => c.id !== p.id) })}>Remove provider</button></div>}
              </div>
            )}
          </div>
        );
      })}
      <div className="prov provbody">
        <b>Custom provider</b>
        <div className="row">
          <input placeholder="my_provider" value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} />
          <input placeholder="https://api.example.com/v1" style={{ flex: 1 }} value={draft.baseURL} onChange={e => setDraft({ ...draft, baseURL: e.target.value })} />
          <button onClick={addCustom}>Add provider</button>
        </div>
        {err && <div className="errtext">{err}</div>}
      </div>
    </section>
  );
}

function JsonTab({ title, hint, value, onSave }: { title: string; hint: React.ReactNode; value: unknown; onSave: (v: Record<string, never>) => Promise<void> }) {
  const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="setsec">
      <h3>{title}</h3>
      <span className="muted">{hint}</span>
      <textarea aria-label={`${title} JSON`} rows={14} className="mono" value={text} onChange={e => { setText(e.target.value); setMsg(null); }} />
      <div className="row">
        <button className="primary" onClick={async () => {
          let v;
          try { v = JSON.parse(text || '{}'); } catch (e) { return setMsg({ ok: false, text: `Invalid JSON: ${(e as Error).message}` }); }
          await onSave(v); setMsg({ ok: true, text: 'Saved' });
        }}>Save</button>
        {msg && <span className={msg.ok ? 'muted ok' : 'errtext'}>{msg.text}</span>}
      </div>
    </section>
  );
}

function PermissionsTab({ cfg, onSave }: { cfg: Cfg; onSave: Props['onSave'] }) {
  const [pre, setPre] = useState('');
  const allow = cfg.allowBash ?? [];
  const trusted = cfg.trustedWorkspaces ?? [];
  return (
    <section className="setsec">
      <h3>Permissions</h3>
      <b>Bash commands that run without asking</b>
      <span className="muted">Commands starting with one of these prefixes skip the approval prompt.</span>
      {allow.length === 0 && <span className="muted">(none)</span>}
      {allow.map(x => (
        <div key={x} className="row listrow"><code style={{ flex: 1 }}>{x}</code>
          <button className="iconbtn" aria-label={`Remove ${x}`} onClick={() => onSave({ allowBash: allow.filter(y => y !== x) })}><Trash size={15} /></button></div>
      ))}
      <form className="row" onSubmit={e => { e.preventDefault(); const v = pre.trim(); if (v) onSave({ allowBash: [...new Set([...allow, v])] }); setPre(''); }}>
        <input aria-label="Command prefix" placeholder="npm test" className="mono" style={{ flex: 1 }} value={pre} onChange={e => setPre(e.target.value)} />
        <button type="submit">Add</button>
      </form>
      <b style={{ marginTop: 16 }}>Trusted workspaces</b>
      <span className="muted">Hooks in these folders&apos; .claude/settings.json are allowed to run. Use /trust in a chat to add the current folder.</span>
      {trusted.length === 0 && <span className="muted">(none)</span>}
      {trusted.map(x => (
        <div key={x} className="row listrow"><code style={{ flex: 1 }} className="ellipsis">{x}</code>
          <button className="iconbtn" aria-label={`Untrust ${x}`} onClick={() => onSave({ trustedWorkspaces: trusted.filter(y => y !== x) })}><Trash size={15} /></button></div>
      ))}
    </section>
  );
}
