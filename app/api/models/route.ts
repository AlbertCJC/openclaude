import { loadConfig, resolveModel } from '@/lib/config';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('provider') ?? '';
  const c = await loadConfig();
  try {
    const { provider, keys } = resolveModel(c, `${id}/x`);
    const r = await fetch(`${provider.baseURL}/models`, { headers: keys[0] ? { Authorization: `Bearer ${keys[0]}` } : {} });
    if (!r.ok) return Response.json({ models: [], error: `${r.status} ${r.statusText}` });
    const data = await r.json();
    return Response.json({ models: (data.data ?? []).map((m: { id: string }) => `${id}/${m.id.replace(/^models\//, '')}`).sort() });
  } catch (e) {
    return Response.json({ models: [], error: e instanceof Error ? e.message : String(e) });
  }
}
