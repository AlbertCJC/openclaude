import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { DATA, loadConfig } from './config';

export type Schedule = { id: string; cron: string; prompt: string; enabled: boolean; lastRun?: number };
const FILE = path.join(DATA, 'schedules.json');

export const listSchedules = async (): Promise<Schedule[]> => JSON.parse(await fs.readFile(FILE, 'utf8').catch(() => '[]'));
const write = async (s: Schedule[]) => { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(FILE, JSON.stringify(s, null, 1)); };

function field(spec: string, v: number, min: number, max: number) {
  return spec.split(',').some(part => {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    const [a, b0] = range === '*' ? [min, max] : range.split('-').map(Number);
    const b = b0 ?? (stepS ? max : a);
    if ([a, b, step].some(Number.isNaN) || step < 1) throw new Error(`Bad cron field "${part}"`);
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
export function cronMatches(cron: string, d: Date) {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) throw new Error('Cron needs 5 fields: minute hour day-of-month month day-of-week');
  return field(f[0], d.getMinutes(), 0, 59) && field(f[1], d.getHours(), 0, 23) && field(f[2], d.getDate(), 1, 31)
    && field(f[3], d.getMonth() + 1, 1, 12) && field(f[4], d.getDay(), 0, 6);
}

export async function addSchedule(cron: string, prompt: string) {
  cronMatches(cron, new Date()); // validate
  const s: Schedule = { id: `sched-${randomUUID().slice(0, 8)}`, cron, prompt, enabled: true };
  await write([...await listSchedules(), s]);
  ensureScheduler();
  return s;
}
export const deleteSchedule = async (id: string) => write((await listSchedules()).filter(s => s.id !== id));

async function runHeadless(s: Schedule) {
  const { generateText, isStepCount } = await import('ai');
  const { prepareAgent } = await import('./agent');
  const { saveChat } = await import('./history');
  const c = { ...await loadConfig(), mode: 'auto' as const };
  const a = await prepareAgent(c, s.prompt);
  // Headless: no one can approve, so anything that would ask is denied.
  const tools = Object.fromEntries(Object.entries(a.tools).filter(([n]) => !['ask_user', 'exit_plan_mode'].includes(n)));
  let text: string;
  try {
    const r = await generateText({
      model: a.model, providerOptions: a.providerOptions, system: a.system, prompt: s.prompt, tools, stopWhen: isStepCount(20),
      toolApproval: async (o: Parameters<typeof a.toolApproval>[0]) => {
        const v = await a.toolApproval(o);
        return v === 'user-approval' ? { type: 'denied' as const, reason: 'Scheduled run: no one to approve' } : v;
      },
    });
    text = r.text;
  } catch (e) { text = `Scheduled run failed: ${(e as Error).message}`; }
  const id = `${s.id}-${Date.now()}`;
  await saveChat({ id, title: `⏰ ${s.prompt.slice(0, 50)}`, updated: Date.now(), messages: [
    { id: `${id}-u`, role: 'user', parts: [{ type: 'text', text: s.prompt }] },
    { id: `${id}-a`, role: 'assistant', parts: [{ type: 'text', text }] },
  ] });
}

const g = globalThis as { __ocScheduler?: NodeJS.Timeout };
export function ensureScheduler() {
  if (g.__ocScheduler) return;
  g.__ocScheduler = setInterval(async () => {
    const now = new Date();
    const list = await listSchedules();
    let changed = false;
    for (const s of list) {
      if (!s.enabled || (s.lastRun && now.getTime() - s.lastRun < 55_000)) continue;
      try { if (!cronMatches(s.cron, now)) continue; } catch { continue; }
      s.lastRun = now.getTime(); changed = true;
      runHeadless(s).catch(() => {});
    }
    if (changed) await write(list);
  }, 30_000); // ponytail: 30s poll + 55s guard so each minute fires once
}
