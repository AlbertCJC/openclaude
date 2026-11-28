// Gate for every request to the desktop server: per-launch token cookie + Host/Origin pinned to our own origin.
const { timingSafeEqual } = require('crypto');

function authorized(req, token, port) {
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false; // DNS rebinding
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false; // cross-site request
  const m = /(?:^|;\s*)oc_token=([^;]*)/.exec(req.headers.cookie || '');
  const got = Buffer.from(m ? m[1] : '');
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

module.exports = { authorized };
