import { timingSafeEqual } from 'crypto';
import { loadConfig, saveConfig, mask, ConfigPatch, PROTECTED, PROVIDERS, SEARCH_PROVIDERS, type Config } from '@/lib/config';
import type { McpServer } from '@/lib/mcp';

type Vals = Record<string, string> | undefined;
const maskVals = (r: Vals) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, mask(v)]));
// A masked value sent back means "unchanged": restore the stored one for the same server and key only.
const unmaskVals = (r: Vals, old: Vals) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, old?.[k] !== undefined && v === mask(old[k]) ? old[k] : v]));

const masked = (c: Config) => ({
  ...c,
  keys: Object.fromEntries(Object.entries(c.keys).map(([p, ks]) => [p, ks.map(mask)])),
  mcpServers: Object.fromEntries(Object.entries(c.mcpServers ?? {}).map(([n, s]) =>
    [n, 'url' in s ? { ...s, headers: maskVals(s.headers) } : { ...s, env: maskVals(s.env) }])),
  catalog: PROVIDERS,
  searchCatalog: SEARCH_PROVIDERS,
});

// Electron main sets OC_ADMIN per launch and sends it only after the user approves a native confirm dialog.
function isAdmin(req: Request) {
  const want = Buffer.from(process.env.OC_ADMIN ?? '');
  const got = Buffer.from(req.headers.get('x-oc-admin') ?? '');
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

export async function GET() {
  return Response.json(masked(await loadConfig()));
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Expected a JSON object' }, { status: 400 });
  delete body.catalog; delete body.searchCatalog; // echoed back by the client, not stored
  const parsed = ConfigPatch.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid config', issues: parsed.error.issues }, { status: 400 });
  const next = parsed.data as Partial<Config>;
  const old = await loadConfig();

  for (const [p, ks] of Object.entries(next.keys ?? {}))
    next.keys![p] = ks.map(k => old.keys[p]?.find(o => mask(o) === k) ?? k).map(k => k.trim()).filter(Boolean);
  for (const [n, s] of Object.entries(next.mcpServers ?? {})) {
    const o = old.mcpServers?.[n] as (McpServer & { env?: Vals; headers?: Vals }) | undefined;
    if ('url' in s) s.headers = unmaskVals(s.headers, o?.headers); else s.env = unmaskVals(s.env, o?.env);
  }

  const changed = PROTECTED.filter(k => k in next && JSON.stringify(next[k]) !== JSON.stringify(old[k]));
  if (changed.length && !isAdmin(req))
    return Response.json({ error: `${changed.join(', ')} can only be changed from the desktop app, after confirming.` }, { status: 403 });

  const c: Config = { ...old, ...next };
  await saveConfig(c);
  return Response.json(masked(c));
}
