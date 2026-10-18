// Minimal RFC 6455 WebSocket server on top of node:http. No dependencies.
//
// Only what the shard needs: text frames, fragmentation, ping/pong, close, a
// payload cap and a heartbeat. Each connection is an EventEmitter that emits
// 'message' (string) and 'close'.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export class WSConnection extends EventEmitter {
  constructor(socket, head){
    super();
    this.socket = socket;
    this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    if (this.buf.length) this._parse();
  }
  _closed(){
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
  _parse(){
    for (;;){
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126){ if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127){
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi) return this.close(1009, 'too big');
        len = lo; off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009, 'too big');
      /* clients must mask; an unmasked client frame is a protocol error */
      if (!masked) return this.close(1002, 'unmasked');
      if (b.length < off + 4 + len) return;
      const key = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= key[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._frame(fin, op, data);
      if (!this.open) return;
    }
  }
  _frame(fin, op, data){
    this.alive = true;                       // any traffic proves the client is there
    if (op === 0x8){ this.close(1000); return; }
    if (op === 0x9){ this._send(0xA, data); return; }
    if (op === 0xA) return;
    if (op === 0x1 || op === 0x2) this.frags = [data];
    else if (op === 0x0) this.frags.push(data);
    else return;
    if (this.frags.reduce((n, f) => n + f.length, 0) > MAX_PAYLOAD) return this.close(1009, 'too big');
    if (fin){
      const msg = Buffer.concat(this.frags).toString('utf8');
      this.frags = [];
      this.emit('message', msg);
    }
  }
  _send(op, payload){
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126){ head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536){ head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(text){ this._send(0x1, Buffer.from(text, 'utf8')); }
  ping(){ this._send(0x9, Buffer.alloc(0)); }
  close(code, reason){
    if (!this.open) return;
    const r = Buffer.from(reason || '', 'utf8');
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code || 1000, 0); r.copy(p, 2);
    try { this._send(0x8, p); } catch {}
    this.socket.end();
    this._closed();
  }
}

/** Attach to an http.Server. `onConnection(ws, req)` is called per accepted socket. */
export function attachWebSocket(server, path, onConnection){
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket'){
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                 'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const ws = new WSConnection(socket, head);
    beat.set.add(ws);
    onConnection(ws, req);
  });
  /* heartbeat: a client that misses two pings is gone */
  const beat = setInterval(() => {
    for (const ws of beat.set){
      if (!ws.open){ beat.set.delete(ws); continue; }
      if (!ws.alive){ ws.close(1001, 'timeout'); beat.set.delete(ws); continue; }
      ws.alive = false; ws.ping();
    }
  }, 20000);
  beat.set = new Set();
  beat.unref();
  return { stop(){ clearInterval(beat); } };
}
