import { promises as fs } from 'fs';
import path from 'path';
import { DATA } from './config';

export type Chat = { id: string; title: string; updated: number; messages: unknown[]; usage?: { input: number; output: number }; workspace?: string; pinned?: boolean };
const DIR = path.join(DATA, 'chats');
const file = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error('Bad chat id');
  return path.join(DIR, `${id}.json`);
};

export async function listChats() {
  const names = await fs.readdir(DIR).catch(() => [] as string[]);
  const chats = await Promise.all(names.filter(n => n.endsWith('.json')).map(n =>
    fs.readFile(path.join(DIR, n), 'utf8').then(t => { const c = JSON.parse(t) as Chat; return { id: c.id, title: c.title, updated: c.updated, workspace: c.workspace, pinned: !!c.pinned }; }).catch(() => null)));
  return chats.filter(Boolean).sort((a, b) => b!.updated - a!.updated);
}
export const loadChat = async (id: string) => JSON.parse(await fs.readFile(file(id), 'utf8')) as Chat;
export async function saveChat(c: Partial<Chat> & { id: string }) {
  await fs.mkdir(DIR, { recursive: true });
  const old = await loadChat(c.id).catch(() => null);
  // Partial updates (e.g. pin toggle) must not wipe fields they omit.
  const patch = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined));
  await fs.writeFile(file(c.id), JSON.stringify({ ...old, ...patch }));
}
export async function addUsage(id: string, input: number, output: number) {
  const c = await loadChat(id).catch(() => null);
  if (!c) return;
  c.usage = { input: (c.usage?.input ?? 0) + input, output: (c.usage?.output ?? 0) + output };
  await fs.writeFile(file(id), JSON.stringify(c));
}
export const deleteChat = (id: string) => fs.rm(file(id), { force: true });
