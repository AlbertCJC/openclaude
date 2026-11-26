'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- tool parts are a dynamic union across MCP/custom tools */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AppWindow, ArrowUp, Check, Copy, Download, FileText, FolderOpen, Globe, KeyRound, LoaderCircle,
  PanelRightClose, Plus, Search, Square, Terminal, Wrench, X,
} from 'lucide-react';
import { ProvidersModal, type Cfg } from './Providers';

declare global { interface Window { desktop?: { pickFolder: () => Promise<string | null> } } }

const TOOL_ICON: Record<string, typeof Wrench> = {
  list_files: FileText, read_file: FileText, grep: Search, write_file: FileText, edit_file: FileText,
  bash: Terminal, web_fetch: Globe, web_search: Search, create_artifact: AppWindow,
};
const MODES = { ask: 'Ask before edits', auto: 'Auto-edit', plan: 'Plan (read-only)' } as const;

type Artifact = { id: string; title: string; html: string };

export default function Page() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [showProv, setShowProv] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelErr, setModelErr] = useState('');
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(setCfg); }, []);
  const save = async (p: Partial<Cfg>) => {
    const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    setCfg(await r.json());
  };
  const providerId = cfg?.model.split('/')[0] ?? '';
  const keyCount = cfg?.keys[providerId]?.length ?? 0;
  useEffect(() => {
    if (!providerId) return;
    fetch(`/api/models?provider=${encodeURIComponent(providerId)}`).then(r => r.json()).then(d => { setModels(d.models); setModelErr(d.error ?? ''); });
  }, [providerId, keyCount]);

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, setMessages, sendMessage, addToolApprovalResponse, status, stop, error } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState('');

  const artifacts = useMemo(() => {
    const out: Artifact[] = [];
    for (const m of messages) for (const p of m.parts as any[])
      if (p.type === 'tool-create_artifact' && p.input?.html) out.push({ id: p.toolCallId, title: p.input.title ?? 'Artifact', html: p.input.html });
    return out;
  }, [messages]);
  const latestId = artifacts.at(-1)?.id;
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => { if (latestId) setShownId(latestId); }, [latestId]);
  const shown = artifacts.find(a => a.id === shownId);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');

  const [artW, setArtW] = useState(560);
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) setArtW(Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth - 520)); };
    const up = () => { dragging.current = false; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const busy = status === 'submitted' || status === 'streaming';
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input });
    setInput('');
  };
  const pickFolder = async () => {
    const dir = window.desktop ? await window.desktop.pickFolder() : prompt('Workspace folder path', cfg?.workspace);
    if (dir) save({ workspace: dir });
  };
  const all = cfg ? [...cfg.catalog, ...cfg.custom] : [];
  const folderName = cfg?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? '';

  return (
    <div className="shell" style={{ gridTemplateColumns: shown ? `240px minmax(0,1fr) ${artW}px` : '240px minmax(0,1fr)' }}>
      {showProv && cfg && <ProvidersModal cfg={cfg} onSave={save} onClose={() => setShowProv(false)} />}

      <aside className="side">
        <div className="brand">OpenClaude</div>
        <button className="navbtn" onClick={() => { stop(); setMessages([]); setShownId(null); }}><Plus size={16} /> New chat</button>

        <div className="sidelabel">Workspace</div>
        <button className="navbtn" onClick={pickFolder} title={cfg?.workspace}>
          <FolderOpen size={16} /><span className="ellipsis">{folderName || 'Open folder'}</span>
        </button>

        {artifacts.length > 0 && <>
          <div className="sidelabel">Artifacts in this chat</div>
          {artifacts.map(a => (
            <button key={a.id} className={`navbtn ${a.id === shownId ? 'active' : ''}`} onClick={() => setShownId(a.id)}>
              <AppWindow size={16} /><span className="ellipsis">{a.title}</span>
            </button>
          ))}
        </>}

        <div className="sidefoot">
          <span className="muted">Coming next: chat history, projects, connectors, skills, memory.</span>
          <button className="navbtn" onClick={() => setShowProv(true)}><KeyRound size={16} /> Providers and API keys</button>
        </div>
      </aside>

      <main className="chat">
        <header className="topbar">
          {cfg && <>
            <select aria-label="Provider" value={providerId}
              onChange={e => save({ model: `${e.target.value}/` + (all.find(p => p.id === e.target.value)?.example.split('/').slice(1).join('/') ?? '') })}>
              {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input aria-label="Model" list="models" className="modelinput" value={cfg.model}
              onChange={e => setCfg({ ...cfg, model: e.target.value })} onBlur={e => save({ model: e.target.value })} />
            <datalist id="models">{models.map(m => <option key={m} value={m} />)}</datalist>
            {keyCount === 0 && !all.find(p => p.id === providerId)?.local
              ? <button className="badge warn" onClick={() => setShowProv(true)}>Add API key</button>
              : <span className="badge" title={modelErr}>{modelErr ? 'Model list unavailable' : `${models.length} models`}</span>}
          </>}
        </header>

        <div className="msgs">
          {messages.length === 0 && (
            <div className="empty">
              <h1>What should we build?</h1>
              <p className="muted">I can read and edit files in your workspace, run commands, search the web, and build artifacts.</p>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={m.role === 'user' ? 'user' : 'bot'}>
              {m.parts.map((p: any, i) => {
                if (p.type === 'text') return m.role === 'user'
                  ? <div key={i} className="usertext">{p.text}</div>
                  : <div key={i} className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown></div>;
                if (p.type === 'reasoning') return <details key={i} className="tool"><summary>Thinking</summary><pre>{p.text}</pre></details>;
                if (!p.type.startsWith('tool-')) return null;
                const name = p.type.slice(5);
                const Icon = TOOL_ICON[name] ?? Wrench;
                if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return (
                  <div key={i} className="tool approve">
                    <div className="toolrow"><Icon size={15} /><b>{name}</b><span className="muted">needs your approval</span></div>
                    <pre>{name === 'bash' ? p.input?.command : JSON.stringify(p.input, null, 2)}</pre>
                    <div className="row">
                      <button className="primary" onClick={() => addToolApprovalResponse({ id: p.approval.id, approved: true })}>Allow</button>
                      <button onClick={() => addToolApprovalResponse({ id: p.approval.id, approved: false })}>Deny</button>
                    </div>
                  </div>
                );
                if (name === 'create_artifact' && p.input?.title) return (
                  <button key={i} className="artchip" onClick={() => setShownId(p.toolCallId)}>
                    <AppWindow size={16} /> {p.input.title}<span className="muted">Open</span>
                  </button>
                );
                const ok = p.state === 'output-available';
                const bad = p.state === 'output-error' || p.state === 'output-denied';
                return (
                  <details key={i} className={`tool ${bad ? 'bad' : ''}`}>
                    <summary className="toolrow">
                      <Icon size={15} /><span>{name}</span>
                      <code className="ellipsis">{p.input ? JSON.stringify(p.input) : ''}</code>
                      {ok ? <Check size={15} className="ok" /> : bad ? <X size={15} className="err" /> : <LoaderCircle size={15} className="spin" />}
                    </summary>
                    <pre>{p.errorText ?? (p.state === 'output-denied' ? 'Denied' : typeof p.output === 'string' ? p.output : JSON.stringify(p.output, null, 2))}</pre>
                  </details>
                );
              })}
            </div>
          ))}
          {error && <div className="tool bad">{error.message}</div>}
        </div>

        <form onSubmit={submit} className="composer">
          <div className="box">
            <textarea aria-label="Message" value={input} onChange={e => setInput(e.target.value)} placeholder="Reply to OpenClaude…" rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <div className="row">
              {cfg && (
                <select aria-label="Permission mode" className="modesel" value={cfg.mode} onChange={e => save({ mode: e.target.value as Cfg['mode'] })}>
                  {Object.entries(MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              <span style={{ flex: 1 }} />
              {busy
                ? <button type="button" className="iconbtn" onClick={stop} aria-label="Stop"><Square size={16} /></button>
                : <button type="submit" className="iconbtn send" aria-label="Send" disabled={!input.trim()}><ArrowUp size={18} /></button>}
            </div>
          </div>
        </form>
      </main>

      {shown && (
        <section className="art">
          <div className="splitter" onMouseDown={() => { dragging.current = true; document.body.style.userSelect = 'none'; }} aria-hidden />
          <div className="arthead">
            <b className="ellipsis">{shown.title}</b>
            <div className="seg">
              <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
              <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Code</button>
            </div>
            <button className="iconbtn" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(shown.html)}><Copy size={15} /></button>
            <button className="iconbtn" aria-label="Download" onClick={() => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([shown.html], { type: 'text/html' }));
              a.download = `${shown.title.replace(/[^\w-]+/g, '_')}.html`;
              a.click();
            }}><Download size={15} /></button>
            <button className="iconbtn" aria-label="Close panel" onClick={() => setShownId(null)}><PanelRightClose size={15} /></button>
          </div>
          {tab === 'preview'
            ? <iframe sandbox="allow-scripts" srcDoc={shown.html} title={shown.title} />
            : <pre className="code">{shown.html}</pre>}
        </section>
      )}
    </div>
  );
}
