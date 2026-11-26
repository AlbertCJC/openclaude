import { loadConfig, saveConfig, mask, PROVIDERS, type Config } from '@/lib/config';

const masked = (c: Config) => ({
  ...c,
  keys: Object.fromEntries(Object.entries(c.keys).map(([p, ks]) => [p, ks.map(mask)])),
  catalog: PROVIDERS,
});

export async function GET() {
  return Response.json(masked(await loadConfig()));
}

export async function PUT(req: Request) {
  const old = await loadConfig();
  const next = (await req.json()) as Config;
  // Masked values sent back mean "unchanged": map them to the stored key.
  for (const [p, ks] of Object.entries(next.keys ?? {}))
    next.keys[p] = ks.map(k => old.keys[p]?.find(o => mask(o) === k) ?? k).map(k => k.trim()).filter(Boolean);
  const c: Config = { ...old, ...next };
  await saveConfig(c);
  return Response.json(masked(c));
}
