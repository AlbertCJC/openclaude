import { deleteChat, listChats, loadChat, saveChat, type Chat } from '@/lib/history';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  try { return Response.json(id ? await loadChat(id) : await listChats()); }
  catch { return new Response('Not found', { status: 404 }); }
}
export async function PUT(req: Request) {
  await saveChat(await req.json() as Chat);
  return Response.json({ ok: true });
}
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (id) await deleteChat(id);
  return Response.json({ ok: true });
}
