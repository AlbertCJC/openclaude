import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { setWorkspace, tools, WRITE_TOOLS } from '@/lib/tools';
import { loadConfig, resolveModel } from '@/lib/config';

export const maxDuration = 300;

// Multi-key fallback like free-claude-code: try key 1, then key 2… on auth/rate-limit errors.
function keyFallbackFetch(keys: string[]): typeof fetch {
  return async (url, init) => {
    let res: Response | undefined;
    for (const key of keys.length ? keys : ['']) {
      const headers = new Headers(init?.headers);
      if (key) headers.set('Authorization', `Bearer ${key}`); else headers.delete('Authorization');
      res = await fetch(url, { ...init, headers });
      if (![401, 402, 403, 429].includes(res.status)) return res;
    }
    return res!;
  };
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const c = await loadConfig();
  setWorkspace(c.workspace);
  let resolved;
  try { resolved = resolveModel(c, c.model); } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  const { provider, modelId, keys } = resolved;
  if (!keys.length && !provider.local) return new Response(`Add a key for ${provider.name} (${provider.keyName}) in Providers.`, { status: 400 });

  const llm = createOpenAICompatible({ name: provider.id, baseURL: provider.baseURL, fetch: keyFallbackFetch(keys) });
  const mode = c.mode;
  const result = streamText({
    model: llm(modelId),
    system: `You are OpenClaude, a helpful assistant with tools. Workspace root: ${c.workspace}. Use relative paths.
Use tools when they help; read before editing. Use create_artifact for any HTML/visual deliverable.
If a tool call is denied, do not retry it.${mode === 'plan' ? '\nPlan mode: only read and research, then present a plan. Do not modify anything.' : ''}`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(20),
    toolApproval: ({ toolCall }) => {
      if (!WRITE_TOOLS.includes(toolCall.toolName)) return undefined;
      if (mode === 'plan') return { type: 'denied', reason: 'Plan mode is read-only' };
      return mode === 'auto' && toolCall.toolName !== 'bash' ? undefined : 'user-approval';
    },
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, onError: e => (e instanceof Error ? e.message : String(e)) }) });
}
