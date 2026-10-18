// The shard: every service of a Ryzom Core shard, collapsed into one process.
//
//   Ryzom service        here                          what it owns
//   ------------------   ---------------------------   ------------------------------
//   welcome / login      services/login.mjs            accounts, sessions, resume tokens
//   EGS (entities)       services/entities.mjs         characters, skills, XP, death,
//                                                       inventory, pickups, loot, hits
//   AIS (ai_service)     services/ai.mjs               NPC hit points, respawns, zone
//                                                       objective, simulation authority
//   EGS mission manager  services/missions.mjs         mission steps and rewards
//   EGS team manager     services/teams.mjs            teams and team XP
//   IOS (chat)           services/chat.mjs             chat channels
//   FS (frontend)        services/frontend.mjs         per-client vision, priority,
//                                                       snapshots
//   BS (backup)          services/backup.mjs           periodic character saves
//   TS (tick)            this file                     the 10 Hz cycle
//
// Services talk through an in-process bus (bus.mjs) the way Ryzom's talk
// through NeL's unified network. The shard runs unchanged under Node behind a
// WebSocket (../server.mjs) or in a browser tab as a local single-player
// shard (../local.mjs): the host supplies storage, password hashing and a
// transport, nothing here touches the network or the file system.
import { createBus } from './bus.mjs';
import { TICK_MS } from './rules.mjs';
import { ZONES } from './zones.mjs';
import { installLogin } from './services/login.mjs';
import { installEntities } from './services/entities.mjs';
import { installAI } from './services/ai.mjs';
import { installMissions } from './services/missions.mjs';
import { installTeams } from './services/teams.mjs';
import { installChat } from './services/chat.mjs';
import { installFrontend } from './services/frontend.mjs';
import { installBackup } from './services/backup.mjs';

export const PROTOCOL = 1;

/**
 * @param {object} host
 * @param {{load(key:string):any, save(key:string, data:any):void}} host.store
 * @param {{hash(pass:string, salt:string):string, token():string}} host.auth
 * @param {(…args)=>void} [host.log]
 * @param {()=>number} [host.now]      seconds
 * @param {()=>number} [host.random]
 * @param {boolean} [host.local]       single-player shard: no passwords
 */
export function createShard(host){
  const log = host.log || (() => {});
  const ctx = {
    bus: createBus(log), store: host.store, auth: host.auth, log,
    now: host.now || (() => Date.now() / 1000),
    rnd: host.random || Math.random,
    local: !!host.local,
    tick: 0,
    players: new Map(),            // pid -> runtime player
    byName: new Map(),             // lower-case name -> player
    zones: ZONES.map((def, idx) => ({ idx, def, players: new Set() })),
    nextPid: 1,
    send(p, msg){ if (p.online) p.out(msg); },
    zoneSend(z, msg, exceptPid){
      for (const pid of z.players){ if (pid === exceptPid) continue; const p = ctx.players.get(pid); if (p) ctx.send(p, msg); }
    },
    sys(p, text){ ctx.send(p, { t: 'sys', text }); },
    dist2(a, b){ const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
  };

  installLogin(ctx);
  installEntities(ctx);
  installAI(ctx);
  installMissions(ctx);
  installTeams(ctx);
  installChat(ctx);
  installFrontend(ctx);
  installBackup(ctx);

  /* client messages that do not need a character */
  const OPEN = new Set(['login', 'resume', 'ping']);

  function connect(out){
    const session = { out, player: null, closed: false };
    return {
      receive(msg){
        if (session.closed || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        if (msg.t === 'ping'){ out({ t: 'pong', c: msg.c, s: ctx.tick }); return; }
        if (OPEN.has(msg.t)){ ctx.bus.emit('c:' + msg.t, { session, m: msg }); return; }
        const p = session.player;
        if (!p) { out({ t: 'err', text: 'chưa đăng nhập' }); return; }
        ctx.bus.emit('c:' + msg.t, { p, m: msg });
      },
      close(){
        if (session.closed) return;
        session.closed = true;
        if (session.player) ctx.bus.emit('logout', session.player);
      }
    };
  }

  function tick(){
    ctx.tick++;
    ctx.bus.emit('tick', ctx.tick);
  }

  let timer = null;
  return {
    ctx, connect, tick,
    start(){ if (!timer) timer = setInterval(tick, TICK_MS); },
    stop(){ if (timer){ clearInterval(timer); timer = null; } ctx.bus.emit('shutdown'); },
    saveAll(){ ctx.bus.emit('saveAll'); }
  };
}
