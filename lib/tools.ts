import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';

export let WORKSPACE = path.resolve(process.env.WORKSPACE || process.cwd());
export const setWorkspace = (w: string) => { WORKSPACE = path.resolve(w); }; // ponytail: module-global, fine for single-user desktop app

export function jail(p: string) {
  const full = path.resolve(WORKSPACE, p);
  const rel = path.relative(WORKSPACE, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path outside workspace: ${p}`);
  return full;
}

async function walk(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 6 || out.length > 2000) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f, out, depth + 1);
    else out.push(path.relative(WORKSPACE, f).replaceAll('\\', '/'));
  }
  return out;
}

const clip = (s: string, n = 20000) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);

export const tools = {
  list_files: tool({
    description: 'List files in the workspace (recursive). Optional substring filter.',
    inputSchema: z.object({ dir: z.string().default('.'), filter: z.string().optional() }),
    execute: async ({ dir, filter }) => {
      const files = await walk(jail(dir));
      return (filter ? files.filter(f => f.includes(filter)) : files).slice(0, 500).join('\n');
    },
  }),
  read_file: tool({
    description: 'Read a text file from the workspace.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path: p }) => clip(await fs.readFile(jail(p), 'utf8')),
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
    description: 'Run a shell command in the workspace (60s timeout).',
    inputSchema: z.object({ command: z.string() }),
    execute: ({ command }) =>
      new Promise<string>(res =>
        exec(command, { cwd: WORKSPACE, timeout: 60000, maxBuffer: 1 << 22 }, (err, stdout, stderr) =>
          res(clip(`${stdout}${stderr}${err ? `\n[exit ${err.code ?? 'error'}]` : ''}`))),
      ),
  }),
  web_fetch: tool({
    description: 'Fetch a URL and return its text content (HTML stripped).',
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs');
      const html = await (await fetch(url, { headers: { 'User-Agent': 'OpenClaude/0.1' } })).text();
      return clip(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    },
  }),
  web_search: tool({
    description: 'Search the web. Returns titles and URLs.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      // ponytail: scrapes DuckDuckGo HTML; swap for SearXNG/Brave API if it breaks
      const html = await (await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })).text();
      const out = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8).map(m => {
        const u = new URL(m[1], 'https://duckduckgo.com').searchParams.get('uddg') || m[1];
        return `${m[2].replace(/<[^>]+>/g, '')} — ${u}`;
      });
      return out.join('\n') || 'No results';
    },
  }),
  create_artifact: tool({
    description: 'Show a self-contained HTML page (or SVG) to the user in the artifact panel. Use for pages, demos, visuals.',
    inputSchema: z.object({ title: z.string(), html: z.string() }),
    execute: async ({ title }) => `Artifact "${title}" shown to user.`,
  }),
};

export const WRITE_TOOLS = ['write_file', 'edit_file', 'bash'];
