// The local shard: the same shard code running inside the browser tab, for
// playing the MMO mode alone when no server is reachable (GitHub Pages, a
// laptop on a train). Characters live in localStorage. Messages are passed
// through JSON so the client code path is exactly the networked one.
import { createShard } from './shard/shard.mjs';

const PREFIX = 'dbp1954.shard.';
const store = {
  load(key){ try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : null; } catch { return null; } },
  save(key, data){ try { localStorage.setItem(PREFIX + key, JSON.stringify(data)); } catch {} }
};
const auth = { hash: () => '', token: () => Math.random().toString(36).slice(2) + Date.now().toString(36) };

let shard = null;
export function connectLocal(onMessage){
  if (!shard){
    shard = createShard({ store, auth, local: true, log: (...a) => console.debug('[shard]', ...a) });
    shard.start();
    addEventListener('pagehide', () => shard.saveAll());
  }
  const conn = shard.connect(msg => { const s = JSON.stringify(msg); setTimeout(() => onMessage(JSON.parse(s)), 0); });
  return {
    send(msg){ const s = JSON.stringify(msg); setTimeout(() => conn.receive(JSON.parse(s)), 0); },
    close(){ conn.close(); shard.saveAll(); }
  };
}
