// Frontend service (Ryzom: frontend_service). Decides, per client and per
// tick, which entity updates are worth sending.
//
// Ryzom's scheme (vision_array.h, distance_prioritizer.cpp): every entity in
// a client's vision gains 10000/distance(mm) priority each cycle — 10 per
// tick at a metre, 0.1 at a hundred — the slots are sorted, the packet is
// filled highest first up to the client's bandwidth, and a sent slot's
// priority resets. A position is only resent once the entity has moved more
// than distance/ratio since the last copy that client got. Near things are
// fresh every tick; distant ones trickle, but are never starved, because
// their priority keeps climbing until they win a slot.
import { FRONTEND } from '../rules.mjs';

const r2 = v => Math.round(v * 100) / 100;

export function installFrontend(ctx){
  const F = FRONTEND;

  ctx.bus.on('zoneEnter', ({ p }) => { p.vis = new Map(); });
  ctx.bus.on('zoneLeave', ({ p }) => { p.vis = new Map(); });

  ctx.bus.on('tick', () => {
    for (const z of ctx.zones){
      if (!z.players.size) continue;
      const ps = [...z.players].map(pid => ctx.players.get(pid)).filter(Boolean);
      for (const viewer of ps){
        if (!viewer.vis) viewer.vis = new Map();
        const cand = [];
        const consider = (key, e, kind) => {
          const d = Math.max(0.1, Math.hypot(e.x - viewer.x, (e.y || 0) - viewer.y, e.z - viewer.z));
          if (d > F.vision) return;
          let v = viewer.vis.get(key);
          if (!v){ v = { prio: 0, x: NaN, z: NaN, yaw: NaN, st: -1, fl: -1, w: -1 }; viewer.vis.set(key, v); }
          v.prio += 10 / d;                              // 10000 / distance in mm
          const moved = Math.hypot(e.x - v.x, e.z - v.z);
          const need = Number.isNaN(v.x) || moved * F.deltaRatio > d || (moved > F.minMove && d < 6) ||
                       Math.abs((e.yaw || 0) - v.yaw) > 0.12 || (e.st|0) !== v.st || (e.fl|0) !== v.fl || (e.w|0) !== v.w ||
                       (kind === 'p' && Math.abs((e.pitch||0) - (v.pitch||0)) > 0.15);
          if (need) cand.push({ key, e, kind, v });
        };
        for (const q of ps) if (q !== viewer) consider('p' + q.pid, q, 'p');
        /* the owner simulates the defenders itself and needs no copy */
        if (z.authority !== viewer.pid) for (const n of z.npcs) if (n.alive && n.known) consider('n' + n.i, n, 'n');
        if (!cand.length) continue;
        cand.sort((a, b) => b.v.prio - a.v.prio);
        const P = [], N = [];
        for (let k = 0; k < Math.min(F.budget, cand.length); k++){
          const { e, kind, v } = cand[k];
          v.prio = 0; v.x = e.x; v.z = e.z; v.yaw = e.yaw || 0; v.st = e.st | 0; v.fl = e.fl | 0; v.w = e.w | 0; v.pitch = e.pitch || 0;
          if (kind === 'p') P.push([e.pid, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), r2(e.pitch), e.fl | 0, e.w | 0]);
          else N.push([e.i, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), e.st | 0, e.fl | 0, e.gen]);
        }
        ctx.send(viewer, { t: 'snap', k: ctx.tick, p: P, n: N });
      }
    }
  });
}
