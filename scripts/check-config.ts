// PUT/GET /api/config: validation, protected fields, secret masking. Run: npm test
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cfg-'));
process.env.OPENCLAUDE_DATA = dir; // DATA is read at module load
process.env.OC_ADMIN = 'x'.repeat(64);
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  mcpServers: { gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: 'ghp_secretsecret123' } }, web: { url: 'https://mcp.example.com', headers: { Authorization: 'Bearer topsecretvalue' } } },
}));

async function main() {
  const { GET, PUT } = await import('../app/api/config/route');
  const put = (body: unknown, admin?: string) => PUT(new Request('http://127.0.0.1/api/config', {
    method: 'PUT', body: JSON.stringify(body), headers: admin ? { 'x-oc-admin': admin } : {},
  }));
  const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));

  // #35: secrets never leave in plain text, and a masked round-trip keeps them.
  const got = await (await GET()).json();
  const text = JSON.stringify(got);
  assert(!text.includes('ghp_secretsecret123') && !text.includes('topsecretvalue'), text);
  assert.strictEqual((await put({ mcpServers: got.mcpServers, catalog: got.catalog })).status, 200); // unchanged: no admin needed
  assert.strictEqual(stored().mcpServers.gh.env.GITHUB_TOKEN, 'ghp_secretsecret123');
  assert.strictEqual(stored().mcpServers.web.headers.Authorization, 'Bearer topsecretvalue');

  // #30: validation.
  assert.strictEqual((await put({ evil: 1 })).status, 400);
  assert.strictEqual((await put({ mode: 'yolo' })).status, 400);
  assert.strictEqual((await put({ mcpServers: { x: { command: 1 } } })).status, 400);
  assert.strictEqual((await put([1])).status, 400);
  assert.strictEqual((await put({ mode: 'auto' })).status, 200);

  // #30: protected fields need the admin header Electron sends after the native confirm.
  for (const patch of [{ allowBash: ['git status'] }, { hooks: { PreToolUse: [] } }, { trustedWorkspaces: ['C:/'] },
    { custom: [{ id: 'evil', name: 'evil', baseURL: 'https://evil.example', keyName: 'K', example: 'evil/x' }] },
    { mcpServers: { ...got.mcpServers, web: { url: 'https://evil.example', headers: got.mcpServers.web.headers } } }]) {
    assert.strictEqual((await put(patch)).status, 403, JSON.stringify(patch));
    assert.strictEqual((await put(patch, 'y'.repeat(64))).status, 403);
  }
  assert.strictEqual((await put({ allowBash: ['git status'] }, process.env.OC_ADMIN)).status, 200);
  assert.deepStrictEqual(stored().allowBash, ['git status']);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('config ok');
}
main().catch(e => { console.error(e); process.exit(1); });
