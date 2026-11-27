// Self-check for phase-2 server logic. Run: npm test
import assert from 'assert';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { cronMatches } from '../lib/schedule';
import { setWorkspace, tools, webSearch } from '../lib/tools';
import { listSkills } from '../lib/skills';
import { runHooks } from '../lib/hooks';
import { readJob, startJob } from '../lib/jobs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { authorized } = require('../electron/auth.js');

const call = (t: { execute?: (...a: never[]) => unknown }, input: unknown) => (t.execute as (i: unknown, o: unknown) => Promise<string>)(input, {});

async function main() {
  const d = new Date(2026, 10, 27, 9, 30); // Fri
  assert(cronMatches('30 9 * * 1-5', d));
  assert(cronMatches('*/15 * * * *', d));
  assert(!cronMatches('0 9 * * *', d));
  assert(!cronMatches('30 9 * * 0,6', d));
  assert.throws(() => cronMatches('* * *', d));

  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-'));
  setWorkspace(ws);
  await fs.writeFile(path.join(ws, 'n.ipynb'), JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(1)\n'], metadata: {}, outputs: [{ text: ['1\n'] }] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
  assert((await call(tools.read_file, { path: 'n.ipynb' })).includes('<output>\n1'));
  await call(tools.notebook_edit, { path: 'n.ipynb', cell_index: 1, new_source: '# Hi', mode: 'insert', cell_type: 'markdown' });
  await call(tools.notebook_edit, { path: 'n.ipynb', cell_index: 0, new_source: 'print(2)\nx=1', mode: 'replace' });
  const nb = JSON.parse(await fs.readFile(path.join(ws, 'n.ipynb'), 'utf8'));
  assert.deepStrictEqual(nb.cells[0].source, ['print(2)\n', 'x=1']);
  assert.deepStrictEqual(nb.cells[0].outputs, []);
  assert.strictEqual(nb.cells[1].cell_type, 'markdown');
  await fs.mkdir(path.join(ws, 'src'));
  await fs.writeFile(path.join(ws, 'src', 'a.ts'), '');
  assert.strictEqual(await call(tools.list_files, { dir: '.', filter: 'src/**/*.ts' }), 'src/a.ts');

  await fs.mkdir(path.join(ws, '.claude', 'skills', 'hello'), { recursive: true });
  await fs.writeFile(path.join(ws, '.claude', 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: "Say hi"\n---\nSay hi.');
  const sk = (await listSkills(ws)).find(s => s.name === 'hello');
  assert.strictEqual(sk?.description, 'Say hi');

  const blocked = await runHooks({ PreToolUse: [{ matcher: 'bash', command: 'node -e "process.stderr.write(\'no bash\');process.exit(2)"' }] }, 'PreToolUse', { tool_name: 'bash' }, ws);
  assert.strictEqual(blocked.blocked, 'no bash');
  const skipped = await runHooks({ PreToolUse: [{ matcher: 'bash', command: 'exit 2' }] }, 'PreToolUse', { tool_name: 'read_file' }, ws);
  assert.strictEqual(skipped.blocked, null);

  const id = startJob('node -e "console.log(42)"', ws);
  await new Promise(r => setTimeout(r, 1500));
  const out = readJob(id);
  assert(out.includes('exited 0') && out.includes('42'), out);
  assert(!readJob(id).includes('42')); // output is consumed once

  const realFetch = globalThis.fetch;
  const hit: string[] = [];
  const stub = (brave: number) => (globalThis.fetch = (async (u: string) => {
    const host = new URL(u).host; hit.push(host);
    if (host.includes('brave')) return new Response(JSON.stringify({ web: { results: [{ title: 'B', url: 'https://b.dev', description: 'snip' }] } }), { status: brave });
    if (host.includes('tavily')) return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.dev' }] }));
    return new Response('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fd.dev">D <b>x</b></a>');
  }) as typeof fetch);
  stub(200);
  assert.strictEqual(await webSearch('q', { search: 'auto', keys: { brave: ['k'] } }), 'B — https://b.dev\n  snip');
  assert.strictEqual(await webSearch('q', { search: 'auto', keys: {} }), 'D x — https://d.dev');
  assert.strictEqual(await webSearch('q', { search: 'tavily', keys: { brave: ['k'], tavily: ['t'] } }), 'T — https://t.dev');
  stub(500); hit.length = 0;
  assert.strictEqual(await webSearch('q', { search: 'brave', keys: { brave: ['k'] } }), 'D x — https://d.dev');
  assert.deepStrictEqual(hit, ['api.search.brave.com', 'html.duckduckgo.com']);
  globalThis.fetch = realFetch;
  const T = 'a'.repeat(64);
  const rq = (h: Record<string, string>) => ({ headers: { host: '127.0.0.1:5000', cookie: `oc_token=${T}`, ...h } });
  assert(authorized(rq({}), T, 5000));
  assert(authorized(rq({ origin: 'http://127.0.0.1:5000', cookie: `x=1; oc_token=${T}` }), T, 5000));
  assert(!authorized(rq({ cookie: '' }), T, 5000));
  assert(!authorized(rq({ cookie: `oc_token=${'b'.repeat(64)}` }), T, 5000));
  assert(!authorized(rq({ cookie: 'oc_token=a' }), T, 5000));
  assert(!authorized(rq({ host: 'evil.com:5000' }), T, 5000));
  assert(!authorized(rq({ origin: 'https://evil.com' }), T, 5000));

  await fs.rm(ws, { recursive: true, force: true });
  console.log('selfcheck ok');
}
main().catch(e => { console.error(e); process.exit(1); });
