import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from 'ai';
import { loadConfig } from '@/lib/config';
import { prepareAgent } from '@/lib/agent';
import { addUsage } from '@/lib/history';
import { ensureScheduler } from '@/lib/schedule';

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages, chatId: id }: { messages: UIMessage[]; chatId?: string } = await req.json();
  const c = await loadConfig();
  ensureScheduler();
  const last = messages.at(-1);
  const prompt = last?.role === 'user' ? last.parts.map(p => (p.type === 'text' ? p.text : '')).join('') : '';
  let a;
  try { a = await prepareAgent(c, prompt); } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  if (a.blocked) return new Response(`Blocked by UserPromptSubmit hook: ${a.blocked}`, { status: 400 });

  const result = streamText({
    model: a.model, providerOptions: a.providerOptions, system: a.system,
    messages: await convertToModelMessages(messages),
    tools: a.tools,
    stopWhen: isStepCount(20),
    toolApproval: a.toolApproval,
    onFinish: ({ totalUsage }) => { if (id) addUsage(id, totalUsage.inputTokens ?? 0, totalUsage.outputTokens ?? 0).catch(() => {}); },
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, onError: e => (e instanceof Error ? e.message : String(e)) }) });
}
