import { loadConfig } from '@/lib/config';
import { getMcp } from '@/lib/mcp';
import { listJobs } from '@/lib/jobs';
import { listSchedules } from '@/lib/schedule';
import { loadChat } from '@/lib/history';

// Backs /mcp, /tasks, /schedule and /cost.
export async function GET(req: Request) {
  const what = new URL(req.url).searchParams.get('what');
  const id = new URL(req.url).searchParams.get('id');
  if (what === 'mcp') return Response.json((await getMcp((await loadConfig()).mcpServers ?? {})).status);
  if (what === 'jobs') return Response.json(listJobs());
  if (what === 'schedules') return Response.json(await listSchedules());
  if (what === 'cost' && id) return Response.json((await loadChat(id).catch(() => null))?.usage ?? { input: 0, output: 0 });
  return new Response('Unknown', { status: 400 });
}
