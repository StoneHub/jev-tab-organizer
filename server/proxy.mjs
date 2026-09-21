import http from 'node:http';
import {classify, validateInput} from './jev.mjs';
const key = process.env.TYPESAFE_API_KEY;
const origin = process.env.EXTENSION_ORIGIN;
if (!key || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin || '')) {
  console.error('Set TYPESAFE_API_KEY and EXTENSION_ORIGIN=chrome-extension://<extension-id> in the server environment.');
  process.exit(1);
}
let active = false, lastRequest = 0;
const server = http.createServer(async (request, response) => {
  const send = (status, body) => { response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); };
  if (request.headers.origin !== origin || request.url !== '/classify' || request.headers.host !== '127.0.0.1:4318') return send(403, {error:'Forbidden'});
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary','Origin');
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods','POST'); response.setHeader('Access-Control-Allow-Headers','Content-Type');
    response.writeHead(204); return response.end();
  }
  if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return send(400, {error:'Expected JSON POST'});
  if (active || Date.now() - lastRequest < 3000) return send(429, {error:'Please wait before retrying'});
  active = true; lastRequest = Date.now();
  try {
    let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 64000) throw new Error('Request too large'); }
    let tabs; try { tabs = validateInput(JSON.parse(raw)); } catch { return send(400, {error:'Invalid request'}); }
    const result = await classify(tabs, key); send(200, result);
  } catch { if (!response.headersSent) send(502, {error:'Classification unavailable; use local sorting'}); }
  finally { active = false; }
});
server.requestTimeout = 15000;
server.listen(4318, '127.0.0.1', () => console.log('Jev gateway listening on http://127.0.0.1:4318/classify (loopback only; no request logging).'));
