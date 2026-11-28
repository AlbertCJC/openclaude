import { generateText, isStepCount, tool, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { bashAutoAllowed, setWorkspace, tools as baseTools, touchesProtected, WRITE_TOOLS } from './tools';
import { resolveModel, type Config } from './config';
import { buildSystem } from './systemPrompt';
import { getMcp } from './mcp';
import { listSkills, loadSkill } from './skills';
import { loadHooks, runHooks } from './hooks';
import { addSchedule, deleteSchedule, listSchedules } from './schedule';

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

/** Everything a chat turn (interactive or scheduled) needs. Throws a user-facing Error on bad config. */
export async function prepareAgent(c: Config, userPrompt = '') {
  setWorkspace(c.workspace);
  const { provider, modelId, keys } = resolveModel(c, c.model);
  if (!keys.length && !provider.local) throw new Error(`Add a key for ${provider.name} (${provider.keyName}) in Providers.`);

  const model = createOpenAICompatible({ name: provider.id, baseURL: provider.baseURL, fetch: keyFallbackFetch(keys) })(modelId);
  // ponytail: medium = provider default; some providers reject reasoning_effort on non-reasoning models
  const providerOptions = c.effort === 'medium' ? {} : { [provider.id]: { reasoningEffort: c.effort } };

  const { list_files, read_file, grep, web_fetch, web_search } = baseTools;
  const extra = {
    task: tool({
      description: 'Delegate a broad read-only research task to a subagent (list/read/grep/web). Returns only its final answer.',
      inputSchema: z.object({ description: z.string(), prompt: z.string() }),
      execute: async ({ prompt }, { abortSignal }) => (await generateText({
        model, providerOptions, abortSignal, stopWhen: isStepCount(15),
        system: `You are a read-only research subagent in workspace ${c.workspace}. Investigate, then reply with a concise conclusion citing path:line.`,
        prompt, tools: { list_files, read_file, grep, web_fetch, web_search },
      })).text,
    }),
    skill: tool({
      description: 'Load a skill (packaged instructions) by name and follow it. Available skills are listed in the system prompt.',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => loadSkill(c.workspace, name),
    }),
    schedule_create: tool({
      description: 'Schedule a prompt to run automatically on a 5-field cron (local time). Runs only while OpenClaude is open; each run saves a new chat.',
      inputSchema: z.object({ cron: z.string(), prompt: z.string() }),
      execute: async ({ cron, prompt }) => `Scheduled ${(await addSchedule(cron, prompt)).id}`,
    }),
    schedule_list: tool({
      description: 'List scheduled prompts.',
      inputSchema: z.object({}),
      execute: async () => JSON.stringify(await listSchedules(), null, 1),
    }),
    schedule_delete: tool({
      description: 'Delete a scheduled prompt by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => { await deleteSchedule(id); return `Deleted ${id}`; },
    }),
  };

  const mcp = await getMcp(c.mcpServers ?? {});
  const hooks = await loadHooks(c);
  const all: ToolSet = { ...baseTools, ...extra, ...mcp.tools };

  // PostToolUse: hook stdout is appended to the tool result.
  if (hooks.PostToolUse?.length) for (const [name, t] of Object.entries(all)) {
    const exec = t.execute;
    if (!exec) continue;
    all[name] = { ...t, execute: async (input: unknown, opts: Parameters<typeof exec>[1]) => {
      const out = await exec(input, opts);
      const { context } = await runHooks(hooks, 'PostToolUse', { tool_name: name, tool_input: input, tool_response: out }, c.workspace);
      return context ? `${typeof out === 'string' ? out : JSON.stringify(out)}\n[hook] ${context}` : out;
    } } as typeof t;
  }

  const isWrite = (name: string) => WRITE_TOOLS.includes(name) || name.startsWith('schedule_') || (name.startsWith('mcp__') && !mcp.readOnly.has(name));
  const toolApproval = async ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
    const pre = await runHooks(hooks, 'PreToolUse', { tool_name: toolCall.toolName, tool_input: toolCall.input }, c.workspace);
    if (pre.blocked) return { type: 'denied' as const, reason: pre.blocked };
    if (!isWrite(toolCall.toolName)) return undefined;
    if (c.mode === 'plan') return { type: 'denied' as const, reason: 'Plan mode is read-only' };
    if (touchesProtected(toolCall.toolName, toolCall.input)) return 'user-approval' as const;
    if (toolCall.toolName === 'bash')
      return bashAutoAllowed(String((toolCall.input as { command?: string })?.command ?? ''), c.allowBash) ? undefined : 'user-approval' as const;
    return c.mode === 'auto' ? undefined : 'user-approval' as const;
  };

  const promptHook = userPrompt ? await runHooks(hooks, 'UserPromptSubmit', { prompt: userPrompt }, c.workspace) : { blocked: null, context: '' };
  const skills = await listSkills(c.workspace);
  let system = await buildSystem(c);
  if (skills.length) system += `\n\n# Skills\nWhen a task matches one of these, call the skill tool with its name before acting:\n${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`;
  if (promptHook.context) system += `\n\n# Hook context\n${promptHook.context}`;

  return { model, providerOptions, tools: all, toolApproval, system, blocked: promptHook.blocked, mcpStatus: mcp.status };
}
