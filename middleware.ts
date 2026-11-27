// Blocks cross-site and DNS-rebound calls to /api/* (matters for `next dev`; the desktop server also requires a token, see electron/auth.js).
import { NextResponse, type NextRequest } from 'next/server';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const origin = req.headers.get('origin');
  if (!LOCAL.has(host.replace(/:\d+$/, '')) || (origin && origin !== `http://${host}`)) {
    return new NextResponse('forbidden', { status: 403 });
  }
}

export const config = { matcher: '/api/:path*' };
