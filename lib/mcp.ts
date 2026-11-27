import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

export type McpServer = { command: string; args?: string[]; env?: Record<string, string> } | { url: string; headers?: Record<string, string> };
type Entry = { key: string; client?: MCPClient; tools: ToolSet; readOnly: Set<string>; error?: string };

// ponytail: one client per server name, rebuilt when its config changes; never idle-closed
const cache = new Map<string, Entry>();

async function connect(name: string, s: McpServer): Promise<Entry> {
  const key = JSON.stringify(s);
  const hit = cache.get(name);
  if (hit?.key === key && !hit.error) return hit;
  await hit?.client?.close().catch(() => {});
  try {
    const client = await createMCPClient({
      name: 'openclaude',
      transport: 'url' in s
        ? { type: 'http', url: s.url, headers: s.headers }
        : new Experimental_StdioMCPTransport({ command: s.command, args: s.args, env: { ...process.env, ...s.env } as Record<string, string> }),
    });
    const defs = await client.listTools();
    const raw = await client.tools();
    const tools: ToolSet = {};
    const readOnly = new Set<string>();
    for (const [t, v] of Object.entries(raw)) tools[`mcp__${name}__${t}`] = v as ToolSet[string];
    for (const d of defs.tools) if ((d as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint) readOnly.add(`mcp__${name}__${d.name}`);
    const e = { key, client, tools, readOnly };
    cache.set(name, e);
    return e;
  } catch (err) {
    const e = { key, tools: {}, readOnly: new Set<string>(), error: (err as Error).message };
    cache.set(name, e);
    return e;
  }
}

export async function getMcp(servers: Record<string, McpServer>) {
  for (const n of cache.keys()) if (!servers[n]) { await cache.get(n)?.client?.close().catch(() => {}); cache.delete(n); }
  const entries = await Promise.all(Object.entries(servers).map(async ([n, s]) => [n, await connect(n, s)] as const));
  const tools: ToolSet = {};
  const readOnly = new Set<string>();
  const status: Record<string, string> = {};
  for (const [n, e] of entries) {
    Object.assign(tools, e.tools);
    e.readOnly.forEach(t => readOnly.add(t));
    status[n] = e.error ? `error: ${e.error}` : `connected (${Object.keys(e.tools).length} tools)`;
  }
  return { tools, readOnly, status };
}
