import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs, realpathSync } from 'fs';
import path from 'path';
import net from 'net';
import { lookup } from 'dns/promises';
import { exec } from 'child_process';
import { killJob, readJob, startJob } from './jobs';
import { DATA, loadConfig, SEARCH_PROVIDERS, type Config } from './config';

export let WORKSPACE = path.resolve(process.env.WORKSPACE || process.cwd());
export const setWorkspace = (w: string) => { WORKSPACE = path.resolve(w); }; // ponytail: module-global, fine for single-user desktop app

const fold = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
export function isInside(child: string, parent: string) {
  const rel = path.relative(fold(parent), fold(child));
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// Realpath of the nearest existing ancestor, so symlinks/junctions, 8.3 names and trailing dots resolve to the real target.
function real(p: string) {
  let cur = p, rest = '';
  for (;;) {
    try { return path.join(realpathSync.native(cur), rest); } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      rest = path.join(path.basename(cur), rest);
      cur = up;
    }
  }
}
const dataDirs = () => [path.resolve(DATA), real(path.resolve(DATA))];
const inData = (p: string) => dataDirs().some(d => isInside(p, d));

export function jail(p: string) {
  const full = path.resolve(WORKSPACE, p);
  const r = real(full);
  if (!isInside(full, WORKSPACE) || !isInside(r, real(WORKSPACE))) throw new Error(`Path outside workspace: ${p}`);
  if (inData(full) || inData(r)) throw new Error(`Path is in app data dir: ${p}`); // config.json holds API keys, hooks, allowBash
  return full;
}

/** allowBash auto-approves only a plain single command: no separators, expansions, redirects or quotes on either shell. */
export const bashAutoAllowed = (cmd: string, allow: string[] = []) =>
  /^[\w ./:=@+,-]+$/.test(cmd) && allow.some(p => p && (cmd === p || cmd.startsWith(p + ' ')));

// Folders whose files run as code later: our hooks/skills, git hooks/config, husky hooks, VS Code tasks.
const CODE_DIRS = ['.claude', '.git', '.husky', '.vscode'];
const CODE_DIR_IN_CMD = /(^|[\\/\s"'=])\.(claude|git|husky|vscode)[. ]*([\\/\s"']|$)/i;
/** Writes that can plant code which runs without approval, or reach app data, must always ask, in every mode. */
export function touchesProtected(name: string, input: unknown) {
  const i = (input ?? {}) as { path?: unknown; command?: unknown };
  if (['write_file', 'edit_file', 'notebook_edit'].includes(name))
    return path.relative(WORKSPACE, path.resolve(WORKSPACE, String(i.path ?? ''))).split(/[\\/]/)
      .some(seg => CODE_DIRS.includes(seg.toLowerCase().replace(/[. ]+$/, '')));
  if (name === 'bash') {
    const cmd = String(i.command ?? '');
    return CODE_DIR_IN_CMD.test(cmd) || dataDirs().some(d => fold(cmd).includes(fold(d)));
  }
  return false;
}

async function walk(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 6 || out.length > 2000) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next'].includes(e.name) || e.isSymbolicLink()) continue; // links could point outside the jail
    const f = path.join(dir, e.name);
    if (inData(f)) continue;
    if (e.isDirectory()) await walk(f, out, depth + 1);
    else out.push(path.relative(WORKSPACE, f).replaceAll('\\', '/'));
  }
  return out;
}

const BLOCKED = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4]] as const)
  BLOCKED.addSubnet(a, n, 'ipv4');
// Includes IPv4-mapped, NAT64 and 6to4 prefixes, which can all embed a private IPv4 address.
for (const [a, n] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10]] as const)
  BLOCKED.addSubnet(a, n, 'ipv6');

// ponytail: checks DNS then fetches, so a rebinding resolver can race it; pin the resolved IP via a custom agent if that matters.
export async function fetchPublic(url: string, init: RequestInit = {}) {
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
    if (addrs.some(a => BLOCKED.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) throw new Error(`Refusing private or loopback address: ${u.host}`);
    const r = await fetch(u, { ...init, redirect: 'manual' });
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!loc) return r;
    url = new URL(loc, u).href;
  }
  throw new Error('Too many redirects');
}

const clip = (s: string, n = 20000) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);

type Hit = { title: string; url: string; snippet?: string };
const json = async (r: Response) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const SEARCH: Record<string, (q: string, key: string) => Promise<Hit[]>> = {
  brave: async (q, key) => ((await json(await fetch(`https://api.search.brave.com/res/v1/web/search?count=8&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  }))).web?.results ?? []).map((r: { title: string; url: string; description?: string }) => ({ title: r.title, url: r.url, snippet: r.description })),
  tavily: async (q, key) => ((await json(await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: 8 }),
  }))).results ?? []).map((r: { title: string; url: string; content?: string }) => ({ title: r.title, url: r.url, snippet: r.content })),
  // Fallback: scrapes DuckDuckGo HTML, breaks when their markup changes.
  duckduckgo: async q => {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return [...(await r.text()).matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({
      title: m[2].replace(/<[^>]+>/g, ''),
      url: new URL(m[1], 'https://duckduckgo.com').searchParams.get('uddg') || m[1],
    }));
  },
};

// ponytail: first key per provider, no retry/backoff; rotate keys like the LLM path if rate limits bite.
export async function webSearch(query: string, c: Pick<Config, 'search' | 'keys'>) {
  const key = (id: string) => (c.keys[id] ?? []).find(Boolean) ?? '';
  const keyed = SEARCH_PROVIDERS.map(p => p.id).filter(id => key(id));
  const order = [...new Set([...(c.search && c.search !== 'auto' ? [c.search] : keyed), 'duckduckgo'])];
  const errors: string[] = [];
  for (const id of order) {
    try {
      const hits = (await SEARCH[id](query, key(id))).slice(0, 8);
      if (!hits.length && id !== 'duckduckgo') { errors.push(`${id}: no results`); continue; }
      return hits.map(h => `${h.title} — ${h.url}${h.snippet ? `\n  ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n') || 'No results';
    } catch (e) { errors.push(`${id}: ${(e as Error).message}`); }
  }
  throw new Error(`web_search failed (${errors.join('; ')})`);
}

type Cell = { cell_type: string; source: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, unknown>; ename?: string; evalue?: string }[] };
const joinSrc = (x: string | string[] | undefined) => (Array.isArray(x) ? x.join('') : x ?? '');
function renderNotebook(json: string) {
  const nb = JSON.parse(json) as { cells: Cell[] };
  return nb.cells.map((c, i) => {
    const outs = (c.outputs ?? []).map(o => o.ename ? `${o.ename}: ${o.evalue}` : joinSrc(o.text) || joinSrc(o.data?.['text/plain'] as string[]) || (o.data ? `[${Object.keys(o.data).join(', ')}]` : '')).filter(Boolean);
    return `<cell ${i} ${c.cell_type}>\n${joinSrc(c.source)}${outs.length ? `\n<output>\n${outs.join('\n')}\n</output>` : ''}\n</cell>`;
  }).join('\n');
}

const run = (command: string) => new Promise<string>(res =>
  exec(command, { cwd: WORKSPACE, timeout: 120000, maxBuffer: 1 << 22 }, (err, stdout, stderr) =>
    res(clip(`${stdout}${stderr}${err ? `\n[exit ${err.code ?? 'error'}]` : ''}`))));
const exists = (f: string) => fs.stat(path.join(WORKSPACE, f)).then(() => true, () => false);

export const tools = {
  list_files: tool({
    description: 'List files in the workspace (recursive). Optional filter: a glob like "src/**/*.ts" or a plain substring.',
    inputSchema: z.object({ dir: z.string().default('.'), filter: z.string().optional() }),
    execute: async ({ dir, filter }) => {
      const files = await walk(jail(dir));
      const match = !filter ? () => true : /[*?]/.test(filter) ? (f: string) => path.matchesGlob(f, filter) : (f: string) => f.includes(filter);
      return files.filter(match).slice(0, 500).join('\n') || 'No files';
    },
  }),
  read_file: tool({
    description: 'Read a text file from the workspace.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path: p }) => {
      const text = await fs.readFile(jail(p), 'utf8');
      return clip(p.endsWith('.ipynb') ? renderNotebook(text) : text);
    },
  }),
  grep: tool({
    description: 'Search file contents in the workspace with a regex. Returns path:line: text.',
    inputSchema: z.object({ pattern: z.string(), dir: z.string().default('.') }),
    execute: async ({ pattern, dir }) => {
      const re = new RegExp(pattern, 'i');
      const hits: string[] = [];
      for (const f of await walk(jail(dir))) {
        const text = await fs.readFile(jail(f), 'utf8').catch(() => '');
        text.split('\n').forEach((l, i) => re.test(l) && hits.length < 200 && hits.push(`${f}:${i + 1}: ${l.trim()}`));
      }
      return hits.join('\n') || 'No matches';
    },
  }),
  write_file: tool({
    description: 'Create or overwrite a file in the workspace.',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path: p, content }) => {
      const f = jail(p);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, content);
      return `Wrote ${content.length} chars to ${p}`;
    },
  }),
  edit_file: tool({
    description: 'Replace an exact, unique string in a file.',
    inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
    execute: async ({ path: p, old_string, new_string }) => {
      const f = jail(p);
      const text = await fs.readFile(f, 'utf8');
      const n = text.split(old_string).length - 1;
      if (n !== 1) throw new Error(`old_string found ${n} times; must be exactly 1`);
      await fs.writeFile(f, text.replace(old_string, () => new_string));
      return `Edited ${p}`;
    },
  }),
  bash: tool({
    description: 'Run a shell command in the workspace (120s timeout). Set run_in_background for servers/watchers/long builds; then read output with bash_output.',
    inputSchema: z.object({ command: z.string(), run_in_background: z.boolean().optional() }),
    execute: async ({ command, run_in_background }) =>
      run_in_background ? `Started ${startJob(command, WORKSPACE)}. Read output with bash_output.` : run(command),
  }),
  bash_output: tool({
    description: 'Read new output from a background job since the last read, plus its status. Optional regex filter on lines.',
    inputSchema: z.object({ id: z.string(), filter: z.string().optional() }),
    execute: async ({ id, filter }) => readJob(id, filter),
  }),
  kill_job: tool({
    description: 'Stop a background job.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => killJob(id),
  }),
  notebook_edit: tool({
    description: 'Edit a Jupyter notebook cell: replace its source, insert a new cell at cell_index, or delete it.',
    inputSchema: z.object({
      path: z.string(), cell_index: z.number().int().min(0), new_source: z.string().default(''),
      mode: z.enum(['replace', 'insert', 'delete']).default('replace'), cell_type: z.enum(['code', 'markdown']).optional(),
    }),
    execute: async ({ path: p, cell_index, new_source, mode, cell_type }) => {
      const f = jail(p);
      const nb = JSON.parse(await fs.readFile(f, 'utf8')) as { cells: Record<string, unknown>[] };
      if (mode !== 'insert' && !nb.cells[cell_index]) throw new Error(`No cell ${cell_index} (notebook has ${nb.cells.length})`);
      const source = new_source.split(/(?<=\n)/);
      if (mode === 'delete') nb.cells.splice(cell_index, 1);
      else if (mode === 'insert') {
        const type = cell_type ?? 'code';
        nb.cells.splice(cell_index, 0, type === 'code' ? { cell_type: type, source, metadata: {}, outputs: [], execution_count: null } : { cell_type: type, source, metadata: {} });
      } else {
        Object.assign(nb.cells[cell_index], { source }, cell_type ? { cell_type } : {});
        if (nb.cells[cell_index].cell_type === 'code') Object.assign(nb.cells[cell_index], { outputs: [], execution_count: null });
      }
      await fs.writeFile(f, JSON.stringify(nb, null, 1) + '\n');
      return `${mode === 'insert' ? 'Inserted' : mode === 'delete' ? 'Deleted' : 'Replaced'} cell ${cell_index} in ${p}`;
    },
  }),
  diagnostics: tool({
    description: "Run the project's type checker/linter (tsc, cargo check, go vet, ruff/pyright) and return errors as path:line: message.",
    inputSchema: z.object({}),
    execute: async () => {
      if (await exists('tsconfig.json')) return run('npx --no-install tsc --noEmit --pretty false');
      if (await exists('Cargo.toml')) return run('cargo check --message-format short');
      if (await exists('go.mod')) return run('go vet ./...');
      if (await exists('pyproject.toml') || await exists('setup.py') || await exists('requirements.txt'))
        return run('ruff check --output-format concise . || pyright');
      return 'No known checker for this project (looked for tsconfig.json, Cargo.toml, go.mod, Python config).';
    },
  }),
  web_fetch: tool({
    description: 'Fetch a URL and return its text content (HTML stripped).',
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      const html = await (await fetchPublic(url, { headers: { 'User-Agent': 'OpenClaude/0.1' } })).text();
      return clip(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    },
  }),
  web_search: tool({
    description: 'Search the web. Returns titles and URLs.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => webSearch(query, await loadConfig()),
  }),
  create_artifact: tool({
    description: 'Show a self-contained HTML page (or SVG) to the user in the artifact panel. Use for pages, demos, visuals.',
    inputSchema: z.object({ title: z.string(), html: z.string() }),
    execute: async ({ title }) => `Artifact "${title}" shown to user.`,
  }),
  todo_write: tool({
    description: 'Write the full task list for multi-step work (replaces the previous list). Keep exactly one item in_progress.',
    inputSchema: z.object({ todos: z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) })) }),
    execute: async ({ todos }) => `Task list updated (${todos.filter(t => t.status === 'completed').length}/${todos.length} done).`,
  }),
  // No execute: answered in the UI via addToolOutput.
  ask_user: tool({
    description: 'Ask the user a multiple-choice question when blocked on their decision. The user may also type a custom answer.',
    inputSchema: z.object({ question: z.string(), options: z.array(z.string()).min(2).max(4) }),
  }),
  exit_plan_mode: tool({
    description: 'In plan mode, present the finished plan (markdown) for approval. If approved, mode switches to Auto-edit and you may implement.',
    inputSchema: z.object({ plan: z.string() }),
  }),
};

export const WRITE_TOOLS = ['write_file', 'edit_file', 'bash', 'notebook_edit', 'kill_job'];
