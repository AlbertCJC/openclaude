'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, Trash, X } from 'lucide-react';

export type Provider = { id: string; name: string; baseURL: string; keyName: string; keysUrl?: string; example: string; local?: boolean };
export type Cfg = { keys: Record<string, string[]>; custom: Provider[]; model: string; workspace: string; mode: 'ask' | 'auto' | 'plan'; catalog: Provider[] };

// Mirrors free-claude-code's provider modal: numbered keys (Add key / remove / reorder), key 1 is used first.
export function ProvidersModal({ cfg, onSave, onClose }: { cfg: Cfg; onSave: (c: Partial<Cfg>) => Promise<void>; onClose: () => void }) {
  const [keys, setKeys] = useState<Record<string, string[]>>(structuredClone(cfg.keys));
  const [custom, setCustom] = useState<Provider[]>(cfg.custom);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: '', baseURL: '' });
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = [...cfg.catalog, ...custom];
  const setRow = (p: string, rows: string[]) => setKeys(k => ({ ...k, [p]: rows }));
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
    setCustom([...custom, { id, name: id, baseURL: draft.baseURL.replace(/\/$/, ''), keyName: `${id.toUpperCase()}_API_KEY`, example: `${id}/<model-id>` }]);
    setDraft({ id: '', baseURL: '' });
    setErr('');
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Providers">
        <div className="row"><b style={{ flex: 1, fontSize: 16 }}>Providers</b><button className="iconbtn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <p className="muted">Keys are stored on this computer only. Key 1 is used first; if it fails with an auth or rate-limit error, the next key is tried.</p>
        <div className="row" style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10 }} aria-hidden />
          <input ref={searchRef} aria-label="Search providers" placeholder="Search providers" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, paddingLeft: 32 }} />
        </div>
        {list.filter(p => (p.name + p.id).toLowerCase().includes(q.toLowerCase())).map(p => {
          const rows = keys[p.id] ?? [];
          return (
            <div key={p.id} className="prov">
              <button className="provhead" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                <span className="muted">{rows.filter(Boolean).length ? `${rows.filter(Boolean).length} key(s)` : p.local ? 'local' : 'not set'}</span>
              </button>
              {open === p.id && (
                <div className="provbody">
                  <div className="muted"><code>{p.keyName}</code> · {p.baseURL} · e.g. <code>{p.example}</code>
                    {p.keysUrl && <> · <a href={p.keysUrl} target="_blank" rel="noreferrer">Get a key</a></>}</div>
                  {rows.map((k, i) => (
                    <div key={i} className="row">
                      <span className="muted" style={{ width: 44 }}>Key {i + 1}</span>
                      <input type="password" aria-label={`${p.name} key ${i + 1}`} value={k} style={{ flex: 1 }} onChange={e => setRow(p.id, rows.map((x, j) => (j === i ? e.target.value : x)))} />
                      <button onClick={() => move(p.id, i, -1)} aria-label="Move up" className="iconbtn"><ChevronUp size={15} /></button>
                      <button onClick={() => move(p.id, i, 1)} aria-label="Move down" className="iconbtn"><ChevronDown size={15} /></button>
                      <button onClick={() => setRow(p.id, rows.filter((_, j) => j !== i))} aria-label="Remove key" className="iconbtn"><Trash size={15} /></button>
                    </div>
                  ))}
                  <div className="row">
                    <button onClick={() => setRow(p.id, [...rows, ''])}>+ Add key</button>
                    {custom.some(c => c.id === p.id) && <button onClick={() => setCustom(custom.filter(c => c.id !== p.id))}>Remove provider</button>}
                  </div>
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
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={async () => { await onSave({ keys, custom }); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
