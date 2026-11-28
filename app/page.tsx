'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- tool parts are a dynamic union across MCP/custom tools */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AppWindow, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Circle, CircleDot, Copy, Download, FileText, Folder, Globe, ListTodo, LoaderCircle,
  Mic, MoreHorizontal, PanelLeft, PanelRightClose, Pin, PinOff, Trash2, Plus, Search, Settings as Gear, Square, SquarePen, Terminal, Wrench, X,
} from 'lucide-react';
import type { Cfg } from './Providers';
import { Settings, type SettingsTab } from './Settings';
import { COMMANDS, PROMPTS, parseCommand, type Command } from '@/lib/commands';

declare global { interface Window { desktop?: { pickFolder: () => Promise<string | null>; confirmConfig: (p: Partial<Cfg>) => Promise<Cfg | null> } } }
// Changing these needs the desktop app's native confirm (see electron/main.js); keep in sync with lib/config.ts PROTECTED.
const PROTECTED = ['hooks', 'allowBash', 'trustedWorkspaces', 'mcpServers', 'custom'];

const TOOL_ICON: Record<string, typeof Wrench> = {
  list_files: FileText, read_file: FileText, grep: Search, write_file: FileText, edit_file: FileText,
  bash: Terminal, bash_output: Terminal, kill_job: Terminal, notebook_edit: FileText, diagnostics: Search, skill: Wrench, web_fetch: Globe, web_search: Search, create_artifact: AppWindow, todo_write: ListTodo, task: Bot,
};
const MODES = { ask: 'Ask', auto: 'Auto', plan: 'Plan' } as const;
const NEXT_MODE = { ask: 'auto', auto: 'plan', plan: 'ask' } as const;
const NEXT_EFFORT = { low: 'medium', medium: 'high', high: 'low' } as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

type Artifact = { id: string; title: string; html: string };
type ChatMeta = { id: string; title: string; updated: number; workspace?: string; pinned?: boolean };
const lastSeg = (p?: string) => p?.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} } };
const newId = () => crypto.randomUUID();

export default function Page() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [view, setView] = useState<'chat' | 'settings' | 'artifacts'>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('model');
  const openSettings = (t: SettingsTab) => { setSettingsTab(t); setView('settings'); };
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  useEffect(() => { setCollapsed(ls.get('side.collapsed') === '1'); try { setClosedGroups(JSON.parse(ls.get('side.closed') ?? '[]')); } catch {} }, []);
  const toggleSide = () => setCollapsed(c => { ls.set('side.collapsed', c ? '0' : '1'); return !c; });
  const toggleGroup = (g: string) => setClosedGroups(l => { const n = l.includes(g) ? l.filter(x => x !== g) : [...l, g]; ls.set('side.closed', JSON.stringify(n)); return n; });
  const [q, setQ] = useState('');
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCollapsed(false); setTimeout(() => searchRef.current?.focus()); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const [models, setModels] = useState<string[]>([]);
  const [modelErr, setModelErr] = useState('');
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(setCfg); }, []);
  /** Saves a config patch; false when cancelled or rejected (the reason is shown). */
  const save = async (p: Partial<Cfg>): Promise<boolean> => {
    try {
      if (Object.keys(p).some(k => PROTECTED.includes(k))) {
        if (!window.desktop?.confirmConfig) throw new Error('This setting can only be changed in the OpenClaude desktop app.');
        const c = await window.desktop.confirmConfig(p);
        if (c) setCfg(c);
        return !!c;
      }
      const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setCfg(body);
      return true;
    } catch (e) { alert(`Settings not saved: ${(e as Error).message}`); return false; }
  };
  const providerId = cfg?.model.split('/')[0] ?? '';
  const keyCount = cfg?.keys[providerId]?.length ?? 0;
  useEffect(() => {
    if (!providerId) return;
    fetch(`/api/models?provider=${encodeURIComponent(providerId)}`).then(r => r.json()).then(d => { setModels(d.models); setModelErr(d.error ?? ''); });
  }, [providerId, keyCount]);

  const [chatId, setChatId] = useState(newId);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const [title, setTitle] = useState('');
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [skills, setSkills] = useState<Command[]>([]);
  const refreshChats = () => fetch('/api/chats').then(r => r.json()).then(setChats).catch(() => {});
  useEffect(() => { refreshChats(); }, []);
  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then((l: { name: string; description: string }[]) =>
      setSkills(l.filter(x => !COMMANDS.some(c => c.name === x.name)).map(x => ({ name: x.name, desc: x.description || 'Skill', skill: true })))).catch(() => {});
  }, [cfg?.workspace]);
  const allCommands = useMemo(() => [...COMMANDS, ...skills], [skills]);
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', body: () => ({ chatId: chatIdRef.current }) }), []);
  const { messages, setMessages, sendMessage, addToolApprovalResponse, addToolOutput, status, stop, error } = useChat({
    transport,
    sendAutomaticallyWhen: o => lastAssistantMessageIsCompleteWithApprovalResponses(o) || lastAssistantMessageIsCompleteWithToolCalls(o),
  });
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');
  const [compacting, setCompacting] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const answer = (toolCallId: string, tool: string, output: string) => addToolOutput({ tool: tool as any, toolCallId, output: output as any });

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
  useEffect(() => {
    // Persist after every finished turn.
    if (busy || !messages.length) return;
    const t = title || ((messages.find(m => m.role === 'user')?.parts.find(p => p.type === 'text') as any)?.text ?? 'Chat').slice(0, 60);
    fetch('/api/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chatId, title: t, updated: Date.now(), messages, workspace: cfg?.workspace }) })
      .then(refreshChats);
  }, [busy, messages, chatId, title]); // eslint-disable-line react-hooks/exhaustive-deps -- workspace captured at save time
  const newChat = () => { stop(); setMessages([]); setShownId(null); setTitle(''); setChatId(newId()); setView('chat'); };
  const openChat = async (id: string) => {
    const c = await fetch(`/api/chats?id=${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : null));
    if (!c) return setNote('Conversation not found.');
    stop(); setChatId(c.id); setTitle(c.title); setMessages(c.messages); setShownId(null); setNote(''); setView('chat');
  };
  const [resumeOpen, setResumeOpen] = useState(false);
  const status_ = (what: string) => fetch(`/api/status?what=${what}&id=${encodeURIComponent(chatId)}`).then(r => r.json());
  useEffect(() => {
    // After /compact finishes, keep only the summary.
    if (!compacting || busy) return;
    setCompacting(false);
    const last = messages.at(-1);
    if (last?.role === 'assistant') setMessages([{ ...last, parts: last.parts.filter(p => p.type === 'text').map(p => ({ ...p, text: `[Summary of earlier conversation]\n${(p as any).text}` })) as any }]);
  }, [busy, compacting, messages, setMessages]);

  const slashQuery = /^\/\S*$/.test(input) ? input.slice(1) : null;
  const menu = slashQuery === null ? [] : allCommands.filter(c => c.name.startsWith(slashQuery));

  const runCommand = (name: string, arg: string) => {
    setNote('');
    if (name === 'plan' || name === 'auto' || name === 'ask') return save({ mode: name });
    if (name === 'model') return arg ? save({ model: arg }) : setNote(`Model: ${cfg?.model}. Usage: /model <provider/model>`);
    if (name === 'effort') return ['low', 'medium', 'high'].includes(arg) ? save({ effort: arg as Cfg['effort'] }) : setNote('Usage: /effort low|medium|high');
    if (name === 'clear') return newChat();
    if (name === 'help') return setNote(allCommands.map(c => `/${c.name}${c.args ? ' ' + c.args : ''} — ${c.desc}`).join('\n'));
    if (name === 'resume') { refreshChats(); return setResumeOpen(true); }
    if (name === 'rename') { if (!arg) return setNote('Usage: /rename <title>'); setTitle(arg); if (messages.length) fetch('/api/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chatId, title: arg, updated: Date.now(), messages }) }).then(refreshChats); return; }
    if (name === 'cost') return status_('cost').then(u => setNote(`This conversation: ${u.input.toLocaleString()} input + ${u.output.toLocaleString()} output tokens.`));
    if (name === 'mcp') return status_('mcp').then(st => setNote(Object.keys(st).length ? Object.entries(st).map(([n, v]) => `${n}: ${v}`).join('\n') : 'No MCP servers. Add them in Settings → MCP servers.'));
    if (name === 'tasks') return status_('jobs').then((l: any[]) => setNote(l.length ? l.map(j => `${j.id} [${j.status}] ${j.command}`).join('\n') : 'No background jobs.'));
    if (name === 'schedule') return status_('schedules').then((l: any[]) => setNote(l.length ? l.map(x => `${x.id}  ${x.cron}  ${x.prompt}`).join('\n') + '\n\nAsk me to create or delete schedules.' : 'No schedules. Ask me e.g. "every weekday at 9, summarize git log".'));
    if (name === 'permissions') {
      const [op, ...rest] = arg.split(' '); const pre = rest.join(' ').trim(); const cur = cfg?.allowBash ?? [];
      if (op === 'add' && pre) return save({ allowBash: [...new Set([...cur, pre])] }).then(ok => ok && setNote(`Allowed: ${pre}`));
      if (op === 'remove' && pre) return save({ allowBash: cur.filter(x => x !== pre) }).then(ok => ok && setNote(`Removed: ${pre}`));
      return setNote(`Bash prefixes that run without asking:\n${cur.join('\n') || '(none)'}\n\n/permissions add <prefix> · /permissions remove <prefix>`);
    }
    if (name === 'trust') {
      if (!cfg || !confirm(`Run hooks from ${cfg.workspace}\\.claude\\settings.json? They execute shell commands on your computer.`)) return;
      return save({ trustedWorkspaces: [...new Set([...(cfg.trustedWorkspaces ?? []), cfg.workspace])] }).then(ok => ok && setNote('Workspace trusted: its hooks will run.'));
    }
    if (name === 'compact') { if (!messages.length) return setNote('Nothing to compact.'); setCompacting(true); }
    sendMessage({ text: PROMPTS[name] + (arg ? `\n\n${arg}` : '') });
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    const cmd = parseCommand(input, allCommands);
    if (cmd?.skill) sendMessage({ text: `Use the "${cmd.name}" skill.${cmd.arg ? `\n\n${cmd.arg}` : ''}` });
    else if (cmd) runCommand(cmd.name, cmd.arg);
    else sendMessage({ text: input });
    setInput('');
  };
  const attach = async (f?: File) => {
    if (!f) return;
    const text = await f.text();
    setInput(i => `${i}${i ? '\n\n' : ''}<file name="${f.name}">\n${text}\n</file>`);
  };
  const [SR, setSR] = useState<any>(null);
  useEffect(() => { const w = window as any; setSR(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null); }, []);
  const dictate = () => {
    const r = new SR();
    r.interimResults = false;
    r.onresult = (ev: any) => setInput(i => `${i}${i ? ' ' : ''}${ev.results[0][0].transcript}`);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  const pickFolder = async () => {
    const dir = window.desktop ? await window.desktop.pickFolder() : prompt('Workspace folder path', cfg?.workspace);
    if (dir) save({ workspace: dir });
  };
  const all = cfg ? [...cfg.catalog, ...cfg.custom] : [];
  const folderName = lastSeg(cfg?.workspace);
  const needsKey = !!cfg && keyCount === 0 && !all.find(p => p.id === providerId)?.local;

  const visible = chats.filter(c => c.title.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, ChatMeta[]>();
  if (folderName) groups.set(folderName, []);
  for (const c of visible) if (!c.pinned) { const g = lastSeg(c.workspace) || 'Other'; groups.set(g, [...(groups.get(g) ?? []), c]); }
  const pinned = visible.filter(c => c.pinned);
  const patchChat = (id: string, p: Partial<ChatMeta>) =>
    fetch('/api/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...p }) }).then(refreshChats);
  const delChat = async (c: ChatMeta) => {
    if (!confirm(`Delete "${c.title}"?`)) return;
    await fetch(`/api/chats?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    if (c.id === chatId) newChat();
    refreshChats();
  };
  const chatRow = (c: ChatMeta) => (
    <div key={c.id} className={`navbtn chatrow ${c.id === chatId && view === 'chat' ? 'active' : ''}`}>
      <button className="chatopen" onClick={() => openChat(c.id)} title={c.title}><span className="ellipsis">{c.title}</span></button>
      <button className="iconbtn ghost del" aria-label={`Options for ${c.title}`} aria-expanded={rowMenu === c.id} onClick={() => setRowMenu(rowMenu === c.id ? null : c.id)}><MoreHorizontal size={15} /></button>
      {rowMenu === c.id && (
        <div className="rowmenu" role="menu" onMouseLeave={() => setRowMenu(null)}>
          <button role="menuitem" onClick={() => { setRowMenu(null); patchChat(c.id, { pinned: !c.pinned }); }}>{c.pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}</button>
          <button role="menuitem" className="err" onClick={() => { setRowMenu(null); delChat(c); }}><Trash2 size={14} /> Delete</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="shell" style={{ gridTemplateColumns: `${collapsed ? 56 : 260}px minmax(0,1fr)${shown ? ` ${artW}px` : ''}` }}>
      <aside className={`side ${collapsed ? 'collapsed' : ''}`}>
        <div className="sideicons">
          <button className="iconbtn ghost" onClick={toggleSide} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar"><PanelLeft size={18} /></button>
          {!collapsed && <span className="brand">OpenClaude</span>}
        </div>
        <button className="navbtn" onClick={newChat} title="New chat"><SquarePen size={16} /><span>New chat</span></button>
        {collapsed
          ? <button className="navbtn" onClick={() => { setCollapsed(false); setTimeout(() => searchRef.current?.focus()); }} title="Search (Ctrl+K)"><Search size={16} /></button>
          : <label className="navbtn searchbox"><Search size={16} />
              <input ref={searchRef} aria-label="Search chats" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ('')} />
              <kbd className="muted">Ctrl+K</kbd></label>}
        <button className={`navbtn ${view === 'artifacts' ? 'active' : ''}`} onClick={() => setView(view === 'artifacts' ? 'chat' : 'artifacts')} title="Artifacts">
          <AppWindow size={16} /><span>Artifacts</span>{artifacts.length > 0 && <span className="muted count">{artifacts.length}</span>}</button>

        {!collapsed && <div className="sidelist">
          {pinned.length > 0 && <>
            <button className="sidelabel grouphead" onClick={() => toggleGroup('\0pinned')}>Pinned {closedGroups.includes('\0pinned') ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
            {!closedGroups.includes('\0pinned') && pinned.map(chatRow)}
          </>}
          {[...groups].filter(([, l]) => l.length).map(([g, l]) => (
            <div key={g}>
              <button className="sidelabel grouphead" onClick={() => toggleGroup(g)} title={g}>
                <span className="ellipsis">{g}</span> {closedGroups.includes(g) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
              {!closedGroups.includes(g) && l.slice(0, 50).map(chatRow)}
            </div>
          ))}
          {q && visible.length === 0 && <span className="muted" style={{ padding: '8px' }}>No chats match.</span>}
        </div>}

        <div className="sidefoot">
          <button className={`navbtn ${view === 'settings' ? 'active' : ''}`} onClick={() => view === 'settings' ? setView('chat') : openSettings(settingsTab)} title="Settings"><Gear size={16} /><span>Settings</span></button>
        </div>
      </aside>

      <main className="chat">
        {view === 'settings' && cfg ? <Settings cfg={cfg} onSave={save} models={models} modelErr={modelErr} tab={settingsTab} setTab={setSettingsTab} />
        : view === 'artifacts' ? (
          <div className="msgs">
            <h2>Artifacts in this chat</h2>
            {artifacts.length === 0 && <p className="muted">No artifacts yet. Ask me to build a page, diagram or app.</p>}
            {artifacts.map(a => (
              <button key={a.id} className="artchip" onClick={() => { setShownId(a.id); setView('chat'); }}>
                <AppWindow size={16} /> {a.title}<span className="muted">Open</span></button>
            ))}
          </div>
        ) : <>
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
                if (name === 'todo_write' && p.input?.todos) return (
                  <div key={i} className="tool todos">
                    {p.input.todos.map((t: any, j: number) => (
                      <div key={j} className={`todo ${t.status}`}>
                        {t.status === 'completed' ? <Check size={14} className="ok" /> : t.status === 'in_progress' ? <CircleDot size={14} /> : <Circle size={14} />}
                        <span>{t.content}</span>
                      </div>
                    ))}
                  </div>
                );
                if ((name === 'ask_user' || name === 'exit_plan_mode') && p.state === 'input-available') {
                  const opts: string[] = name === 'ask_user' ? p.input?.options ?? [] : ['Approve and start', 'Keep planning'];
                  return (
                    <div key={i} className="tool approve">
                      {name === 'ask_user'
                        ? <div className="toolrow"><b>{p.input?.question}</b></div>
                        : <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.input?.plan ?? ''}</ReactMarkdown></div>}
                      <div className="row">
                        {opts.map((o, j) => <button key={o} className={j === 0 ? 'primary' : ''} onClick={async () => {
                          if (name === 'exit_plan_mode' && j === 0) await save({ mode: 'auto' });
                          answer(p.toolCallId, name, name === 'ask_user' ? o
                            : j === 0 ? 'User approved the plan. Mode is now Auto-edit: implement it.' : 'User wants to keep planning. Ask what to change.');
                        }}>{o}</button>)}
                      </div>
                    </div>
                  );
                }
                if (name === 'exit_plan_mode' && p.input?.plan) return (
                  <details key={i} className="tool"><summary className="toolrow"><ListTodo size={15} />Plan · {String(p.output ?? '').startsWith('User approved') ? 'approved' : 'answered'}</summary>
                    <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.input.plan}</ReactMarkdown></div></details>
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
          {note && <pre className="note">{note}<button type="button" className="iconbtn" aria-label="Dismiss" onClick={() => setNote('')}><X size={14} /></button></pre>}
          {resumeOpen && (
            <div className="slashmenu" role="listbox" aria-label="Resume conversation">
              <div className="row" style={{ padding: '4px 10px' }}><b>Resume a conversation</b><span style={{ flex: 1 }} />
                <button type="button" className="iconbtn ghost" aria-label="Close" onClick={() => setResumeOpen(false)}><X size={14} /></button></div>
              {chats.length === 0 && <span className="muted" style={{ padding: '6px 10px' }}>No saved conversations yet.</span>}
              {chats.map(c => (
                <button type="button" key={c.id} onClick={() => { setResumeOpen(false); openChat(c.id); }}>
                  <span className="ellipsis">{c.title}</span><span className="muted desc">{new Date(c.updated).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {menu.length > 0 && (
            <div className="slashmenu" role="listbox">
              {menu.map((c, j) => (
                <button type="button" role="option" aria-selected={j === menuIdx % menu.length} key={c.name}
                  className={j === menuIdx % menu.length ? 'on' : ''} onMouseDown={e => { e.preventDefault(); setInput(`/${c.name}${c.args ? ' ' : ''}`); }}>
                  <b>/{c.name}</b>{c.args && <span className="muted"> {c.args}</span>}<span className="muted desc">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          <div className="box">
            <textarea aria-label="Message" value={input} onChange={e => { setInput(e.target.value); setMenuIdx(0); }} placeholder="Describe a task or ask a question" rows={1}
              onKeyDown={e => {
                if (menu.length) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenuIdx(n => (n + (e.key === 'ArrowDown' ? 1 : menu.length - 1)) % menu.length); return; }
                  const c = menu[menuIdx % menu.length];
                  if (e.key === 'Tab' || (e.key === 'Enter' && input !== `/${c.name}`)) { e.preventDefault(); setInput(`/${c.name}${c.args ? ' ' : ''}`); return; }
                  if (e.key === 'Escape') { setInput(''); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              }} />
            <div className="row">
              <button type="button" className="iconbtn ghost" aria-label="Attach file" onClick={() => fileRef.current?.click()}><Plus size={18} /></button>
              <input ref={fileRef} type="file" hidden onChange={e => { attach(e.target.files?.[0]); e.target.value = ''; }} />
              <span style={{ flex: 1 }} />
              {SR && <button type="button" className={`iconbtn ghost ${listening ? 'live' : ''}`} aria-label="Dictate" onClick={dictate} disabled={listening}><Mic size={17} /></button>}
              {busy
                ? <button type="button" className="iconbtn" onClick={stop} aria-label="Stop"><Square size={16} /></button>
                : input.trim() && <button type="submit" className="iconbtn send" aria-label="Send"><ArrowUp size={18} /></button>}
            </div>
          </div>
          {cfg && (
            <div className="under">
              <button type="button" className="chip" onClick={pickFolder} title={cfg.workspace}><Folder size={14} /><span className="ellipsis">{folderName || 'Open folder'}</span></button>
              <span style={{ flex: 1 }} />
              {needsKey && <button type="button" className="chip warn" onClick={() => openSettings('providers')}>Add API key</button>}
              <button type="button" className="chip" title="Model (opens Settings)" onClick={() => openSettings('model')}><span className="ellipsis">{cfg.model.split('/').at(-1)}</span></button>
              <button type="button" className="chip" title="Reasoning effort (click to change)" onClick={() => save({ effort: NEXT_EFFORT[cfg.effort] })}>
                <span className="muted">{cap(cfg.effort)}</span>
              </button>
              <button type="button" className={`chip mode-${cfg.mode}`} title="Permission mode (click to change)" onClick={() => save({ mode: NEXT_MODE[cfg.mode] })}>{MODES[cfg.mode]}</button>
              <span className="status" aria-label={busy ? 'Working' : 'Idle'}>{busy ? <LoaderCircle size={16} className="spin" /> : <Circle size={14} />}</span>
            </div>
          )}
        </form>
        </>}
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
