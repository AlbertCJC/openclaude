import { loadConfig } from '@/lib/config';
import { listSkills } from '@/lib/skills';

export async function GET() {
  const c = await loadConfig();
  return Response.json((await listSkills(c.workspace)).map(({ name, description }) => ({ name, description })));
}
