import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { Config } from './config';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit';
type Hook = { matcher?: string; command: string };
type Hooks = Partial<Record<HookEvent, Hook[]>>;

// Accepts both our flat form and Claude Code's settings.json form: [{matcher, hooks:[{type:'command',command}]}]
function normalize(h: unknown): Hooks {
  const out: Hooks = {};
  for (const [ev, list] of Object.entries((h ?? {}) as Record<string, unknown[]>))
    out[ev as HookEvent] = (list ?? []).flatMap(raw => {
      const x = raw as Hook & { hooks?: { command: string }[] };
      return x.command ? [{ matcher: x.matcher, command: x.command }] : (x.hooks ?? []).map(y => ({ matcher: x.matcher, command: y.command }));
    });
  return out;
}

export async function loadHooks(c: Config): Promise<Hooks> {
  const hooks = normalize(c.hooks);
  if (c.trustedWorkspaces?.includes(path.resolve(c.workspace))) {
    const proj = await fs.readFile(path.join(c.workspace, '.claude', 'settings.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    for (const [ev, list] of Object.entries(normalize(proj.hooks))) hooks[ev as HookEvent] = [...(hooks[ev as HookEvent] ?? []), ...list!];
  }
  return hooks;
}

const run = (command: string, input: string, cwd: string) => new Promise<{ code: number; stdout: string; stderr: string }>(res => {
  const p = spawn(command, { cwd, shell: true, windowsHide: true, timeout: 30000 });
  let stdout = '', stderr = '';
  p.stdout.on('data', b => (stdout += b));
  p.stderr.on('data', b => (stderr += b));
  p.on('close', code => res({ code: code ?? 1, stdout, stderr }));
  p.on('error', e => res({ code: 1, stdout, stderr: String(e) }));
  p.stdin.end(input);
});

/** Runs matching hooks. Returns block reason (exit 2) and any stdout to add to context. */
export async function runHooks(hooks: Hooks, event: HookEvent, payload: Record<string, unknown>, cwd: string) {
  let context = '';
  for (const h of hooks[event] ?? []) {
    if (h.matcher && payload.tool_name && !new RegExp(`^(${h.matcher})$`).test(String(payload.tool_name))) continue;
    const r = await run(h.command, JSON.stringify({ hook_event_name: event, cwd, ...payload }), cwd);
    if (r.code === 2) return { blocked: r.stderr.trim() || 'Blocked by hook', context };
    context += r.stdout;
  }
  return { blocked: null as string | null, context: context.trim() };
}
