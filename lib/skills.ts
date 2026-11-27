import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export type Skill = { name: string; description: string; dir: string; file: string };

export async function listSkills(ws: string): Promise<Skill[]> {
  const roots = [path.join(os.homedir(), '.claude', 'skills'), path.join(ws, '.claude', 'skills')];
  const out = new Map<string, Skill>(); // project skills override user skills of the same name
  for (const root of roots) {
    for (const d of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory()) continue;
      const file = path.join(root, d.name, 'SKILL.md');
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (!text) continue;
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      const get = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm)?.[1].trim().replace(/^["']|["']$/g, '');
      const name = get('name') || d.name;
      out.set(name, { name, description: get('description') ?? '', dir: path.dirname(file), file });
    }
  }
  return [...out.values()];
}

export async function loadSkill(ws: string, name: string) {
  const s = (await listSkills(ws)).find(x => x.name === name);
  if (!s) throw new Error(`Unknown skill: ${name}`);
  const body = (await fs.readFile(s.file, 'utf8')).replace(/^---[\s\S]*?---\r?\n/, '');
  return `Skill "${s.name}" (folder: ${s.dir}). Follow these instructions:\n\n${body}`;
}
