#!/usr/bin/env node
// Điện Biên Phủ 1954 — MMO shard server. Node 18+, no dependencies.
//
//   node mmo/server.mjs [--port 8080] [--data mmo/data] [--host 0.0.0.0]
//
// Serves the repository over HTTP (so the game and the shard share an
// origin) and the shard over a WebSocket at /shard. Characters are JSON files
// under --data, one per character, written atomically.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { scryptSync, randomBytes } from 'node:crypto';
import { attachWebSocket } from './net/websocket.mjs';
import { createShard, PROTOCOL } from './shard/shard.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = +(args.port || process.env.PORT || 8080);
const HOST = args.host || process.env.HOST || '0.0.0.0';
const DATA = path.resolve(args.data || process.env.SHARD_DATA || path.join(ROOT, 'mmo', 'data'));
const QUIET = !!args.quiet;

/* ---- storage: one JSON file per key, written via rename so a crash never
   leaves half a character behind ---- */
fs.mkdirSync(path.join(DATA, 'char'), { recursive: true });
const safeKey = k => k.split('/').map(s => encodeURIComponent(s)).join('/');
const store = {
  load(key){
    try { return JSON.parse(fs.readFileSync(path.join(DATA, safeKey(key) + '.json'), 'utf8')); }
    catch { return null; }
  },
  save(key, data){
    const f = path.join(DATA, safeKey(key) + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  }
};
const auth = {
  hash: (pass, salt) => scryptSync(pass, salt, 32).toString('hex'),
  token: () => randomBytes(18).toString('hex')
};
const log = (...a) => { if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };

const shard = createShard({ store, auth, log });

/* ---- static files ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
                '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
                '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/'){ res.writeHead(302, { Location: '/dienbienphu/?mmo=1' }); res.end(); return; }
  if (u.pathname === '/shard/status'){
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ proto: PROTOCOL, players: shard.ctx.players.size, zones: shard.ctx.zoneList() }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  /* stay inside the repository and away from the shard's own data */
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA) || rel.includes('/.git')){ res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

/* ---- the shard socket ---- */
attachWebSocket(server, '/shard', (ws, req) => {
  const conn = shard.connect(msg => { try { ws.send(JSON.stringify(msg)); } catch {} });
  let budget = 120, last = Date.now();
  ws.on('message', text => {
    /* a client gets 120 messages a second, refilled continuously: position
       and hit claims at full rate, plus the zone's AI stream when it owns one */
    const now = Date.now(); budget = Math.min(120, budget + (now - last) * 0.12); last = now;
    if (--budget < 0) return;
    let msg; try { msg = JSON.parse(text); } catch { return; }
    conn.receive(msg);
  });
  ws.on('close', () => conn.close());
  log('connection from', req.socket.remoteAddress);
});

shard.start();
server.listen(PORT, HOST, () => {
  console.log(`Shard Điện Biên Phủ đang chạy: http://localhost:${PORT}/  (dữ liệu: ${DATA})`);
});
const stop = () => { console.log('Đang lưu và tắt shard…'); shard.stop(); server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
