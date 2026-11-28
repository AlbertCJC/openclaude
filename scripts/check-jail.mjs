// Run: npm test
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DATA is read at module load, so point it inside a temp workspace before importing.
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-jail-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-out-'));
process.env.OPENCLAUDE_DATA = path.join(ws, 'data');
fs.mkdirSync(process.env.OPENCLAUDE_DATA);
fs.writeFileSync(path.join(ws, 'data', 'config.json'), '{}');
const { jail, setWorkspace, bashAutoAllowed, touchesProtected, fetchPublic } = await import('../lib/tools.ts');
setWorkspace(ws);

assert.ok(jail('README.md').endsWith('README.md'));
assert.ok(jail('..foo').endsWith('..foo')); // a name starting with dots is not a parent ref
for (const bad of ['../x', '../../Windows/win.ini', 'C:/Windows/win.ini', '/etc/passwd'])
  assert.throws(() => jail(bad), /outside workspace/, bad);

// #26: app data dir is off-limits even inside the workspace, whatever the case or spelling.
for (const bad of ['data/config.json', 'data', './data/../data/config.json', process.platform === 'win32' ? 'DATA/Config.json' : 'data/x'])
  assert.throws(() => jail(bad), /app data dir/, bad);

// Symlink/junction escape.
try {
  fs.symlinkSync(outside, path.join(ws, 'link'), 'junction');
  assert.throws(() => jail('link/secret.txt'), /outside workspace/);
  fs.symlinkSync(path.join(ws, 'data'), path.join(ws, 'dlink'), 'junction');
  assert.throws(() => jail('dlink/config.json'), /outside workspace|app data dir/);
} catch (e) { if (e.code !== 'EPERM') throw e; console.log('symlink tests skipped (no permission)'); }

// #7: allowBash only auto-approves a plain single command.
const allow = ['git status', 'npm test'];
assert.ok(bashAutoAllowed('git status', allow));
assert.ok(bashAutoAllowed('git status --short', allow));
for (const bad of ['git status\nrm -rf x', 'git status\r\nrm x', 'git status\trm', 'git status & del x', 'git status && x', 'git status | x',
  'git status; x', 'git status `x`', 'git status $(x)', 'git status %COMSPEC%', 'git status ^& x', 'git status (x)', 'git status > f',
  'git status "x"', 'git statusx', ' git status'])
  assert.ok(!bashAutoAllowed(bad, allow), JSON.stringify(bad));

// #27: anything that can plant .claude hooks/skills, or touch app data, always asks.
for (const [name, input] of [['write_file', { path: '.claude/settings.json' }], ['edit_file', { path: '.Claude\\settings.json' }],
  ['notebook_edit', { path: 'sub/.claude./x' }], ['bash', { command: 'echo x > .claude/settings.json' }],
  ['bash', { command: 'node x.js .claude' }], ['write_file', { path: '.git/hooks/pre-commit' }], ['edit_file', { path: '.git/config' }],
  ['write_file', { path: '.husky/pre-commit' }], ['write_file', { path: '.vscode/tasks.json' }], ['bash', { command: 'node x.js .git/hooks/post-checkout' }], ['bash', { command: `type ${path.join(ws, 'data', 'config.json')}` }]])
  assert.ok(touchesProtected(name, input), `${name} ${JSON.stringify(input)}`);
for (const [name, input] of [['write_file', { path: 'src/claude.ts' }], ['write_file', { path: '.github/workflows/ci.yml' }], ['write_file', { path: 'docs/git.md' }], ['bash', { command: 'git status' }], ['read_file', { path: '.claude/x' }]])
  assert.ok(!touchesProtected(name, input), `${name} ${JSON.stringify(input)}`);

// #8: web_fetch refuses loopback/private targets (rejected before any request is sent).
for (const u of ['http://127.0.0.1:3000/api/config', 'http://localhost/', 'http://[::1]/', 'http://[::ffff:7f00:1]/',
  'http://169.254.169.254/latest', 'http://10.0.0.1/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://2130706433/', 'file:///etc/passwd'])
  await assert.rejects(fetchPublic(u), /private or loopback|Only http/, u);

fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('jail ok');
