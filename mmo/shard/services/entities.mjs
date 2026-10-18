// Entities game service (Ryzom: entities_game_service). Owns the character:
// skills and XP, the death penalty, inventory and money, supply pickups and
// loot crates, and where everybody is. Hit points stay client-side in this
// co-operative game — the shard records them for team frames and death.
import {
  SKILLS, SKILL_MAX, WEAPON_SKILL, xpForNext, isUnlocked, bestSkill, rankOf, hpMax, regen, weaponMods,
  KILL_XP_BASE, MAX_XP_PER_KILL, XP_TEAM_DIVISOR, MAX_DIST_XP, xpFactor, DEATH, deathDebt,
  LOOT, rollLoot, PICKUP_RESPAWN, SHOP
} from '../rules.mjs';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(finite);
const r2 = v => Math.round(v * 100) / 100;
const BOUND = 31;

export function installEntities(ctx){
  let lootSeq = 0;
  for (const z of ctx.zones){
    z.pickups = z.def.pickups.map(() => ({ taken: false, at: 0 }));
    z.loots = new Map();
  }

  /* ---- views sent to clients ---- */
  ctx.charView = p => {
    const c = p.char, skills = {}, mods = {};
    for (const id in SKILLS){
      const s = c.skills[id] || (c.skills[id] = { lv: 1, xp: 0 });
      skills[id] = { name: SKILLS[id].name, lv: s.lv, xp: Math.floor(s.xp), next: xpForNext(s.lv), open: isUnlocked(c.skills, id) };
    }
    WEAPON_SKILL.forEach(id => { mods[id] = weaponMods(c.skills[id].lv); });
    mods.nade = weaponMods(c.skills.nade.lv);
    const best = bestSkill(c.skills);
    return { name: c.name, money: c.money, inv: c.inv, skills, mods, best, rank: rankOf(best),
             hpMax: hpMax(c.skills), regen: regen(c.skills), debt: Math.ceil(c.debt), stats: c.stats,
             zone: c.zone, lastSkill: c.lastSkill };
  };
  ctx.zoneList = () => ctx.zones.map(z => ({ idx: z.idx, name: z.def.name, level: z.def.level, players: z.players.size }));
  ctx.pubPlayer = p => ({ pid: p.pid, name: p.name, best: bestSkill(p.char.skills), rank: rankOf(bestSkill(p.char.skills)),
                         team: p.team ? p.team.id : 0, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), fl: p.fl, w: p.w });
  const pushChar = p => ctx.send(p, { t: 'char', char: ctx.charView(p) });
  ctx.pushChar = pushChar;

  /* ---- XP ---- */
  ctx.grantXp = (p, skillId, amount, reason) => {
    if (!SKILLS[skillId] || !(amount > 0)) return;
    const c = p.char;
    if (!isUnlocked(c.skills, skillId)) skillId = 'smg';
    /* death_penalties.cpp:133 — a share of everything earned pays the debt first */
    let repaid = 0;
    if (c.debt > 0){
      repaid = Math.min(c.debt, amount * DEATH.repayShare);
      c.debt -= repaid; amount -= repaid;
    }
    const s = c.skills[skillId];
    const before = hpMax(c.skills), opened = Object.keys(SKILLS).filter(id => isUnlocked(c.skills, id));
    s.xp += amount;
    const ups = [];
    while (s.lv < SKILL_MAX && s.xp >= xpForNext(s.lv)){ s.xp -= xpForNext(s.lv); s.lv++; ups.push(s.lv); }
    if (s.lv >= SKILL_MAX) s.xp = 0;
    p.dirty = true;
    ctx.send(p, { t: 'xp', skill: skillId, gain: Math.round(amount), repaid: Math.round(repaid), reason });
    if (ups.length){
      const nowOpen = Object.keys(SKILLS).filter(id => isUnlocked(c.skills, id) && !opened.includes(id));
      /* character.cpp: a skill level up refills every score */
      ctx.send(p, { t: 'levelUp', skill: skillId, name: SKILLS[skillId].name, lv: s.lv, unlocked: nowOpen.map(id => SKILLS[id].name),
                    hpMax: hpMax(c.skills), refill: true, hpUp: hpMax(c.skills) - before });
      p.hpMax = hpMax(c.skills); p.hp = p.hpMax;
      ctx.bus.emit('levelUp', { p, skill: skillId, lv: s.lv });
    }
    pushChar(p);
  };

  ctx.give = (p, c, reason) => {
    const ch = p.char, grant = {};
    if (c.money){ ch.money += c.money; grant.money = c.money; }
    if (c.nade){ const n = Math.min(SHOP.nade.max - ch.inv.nade, c.nade); if (n > 0){ ch.inv.nade += n; grant.nade = n; } }
    if (c.bandage){ const n = Math.min(SHOP.bandage.max - ch.inv.bandage, c.bandage); if (n > 0){ ch.inv.bandage += n; grant.bandage = n; } }
    if (c.ammo) grant.ammo = true;
    if (c.heal) grant.heal = c.heal;
    p.dirty = true;
    ctx.send(p, { t: 'grant', gain: grant, inv: ch.inv, money: ch.money, reason });
  };

  /* Kill XP, progression_pve.cpp: only the group that did the most damage is
     paid; the factor comes from the gap between the best skill that group used
     and the target's level; the divisor is 1 + 0.9 per extra member; members
     beyond 50 m count in the divisor but get nothing. */
  ctx.bus.on('npcKilled', ({ z, npc, killer, head, weapon }) => {
    let best = null;
    for (const g of npc.dmg.values()) if (!best || g.dmg > best.dmg) best = g;
    if (!best) return;
    let members;
    if (best.team){
      members = best.team.members.map(pid => ctx.players.get(pid)).filter(Boolean);
    } else members = [ctx.players.get(best.pid)].filter(Boolean);
    let skillRef = 1;
    for (const [pid, sk] of best.used){
      const q = ctx.players.get(pid);
      if (q) skillRef = Math.max(skillRef, q.char.skills[sk].lv);
    }
    const factor = xpFactor(skillRef, npc.lvl);
    const divisor = 1 + (members.length - 1) * XP_TEAM_DIVISOR;
    const xp = Math.min(MAX_XP_PER_KILL, KILL_XP_BASE * (1 + 0.15 * (npc.lvl - 1)) * factor / divisor);
    for (const q of members){
      if (q.zone !== z.idx || q.dead) continue;
      if (Math.sqrt(ctx.dist2(q, npc)) > MAX_DIST_XP) continue;
      if (xp <= 0.5){ if (q === killer) ctx.sys(q, 'Đối thủ quá yếu so với kỹ năng — không còn kinh nghiệm.'); continue; }
      const sk = best.used.get(q.pid) || q.char.lastSkill;
      ctx.grantXp(q, sk, xp, 'kill');
    }
    if (killer){
      killer.char.stats.kills++;
      if (head) killer.char.stats.heads++;
      killer.dirty = true;
    }
    /* a crate from the body */
    if (ctx.rnd() < LOOT.chance){
      const id = ++lootSeq;
      const owners = members.map(q => q.pid);
      const loot = { id, x: r2(npc.x), y: r2(npc.y), z: r2(npc.z), c: rollLoot(npc.lvl, ctx.rnd),
                     owners: new Set(owners), rightsUntil: ctx.now() + LOOT.rightsSeconds, until: ctx.now() + LOOT.despawnSeconds };
      z.loots.set(id, loot);
      ctx.zoneSend(z, { t: 'loot', id, x: loot.x, y: loot.y, z: loot.z, owners });
    }
  });

  /* ---- zones ---- */
  function leaveZone(p){
    if (p.zone < 0) return;
    const z = ctx.zones[p.zone];
    /* remember where they stood, so a reconnect puts them back there */
    if (!p.dead) p.char.pos = { x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw) };
    p.dirty = true;
    z.players.delete(p.pid);
    ctx.bus.emit('zoneLeave', { p, z });
    ctx.zoneSend(z, { t: 'pleave', pid: p.pid });
    p.zone = -1;
  }
  ctx.bus.on('c:join', ({ p, m }) => {
    const zi = m.zone | 0;
    if (zi < 0 || zi >= ctx.zones.length) return;
    leaveZone(p);
    const z = ctx.zones[zi], c = p.char;
    const sameZone = c.zone === zi && c.pos;
    const at = sameZone ? c.pos : { x: z.def.spawn.x, y: null, z: z.def.spawn.z, yaw: null };
    c.zone = zi; p.zone = zi;
    p.x = at.x; p.y = at.y || 0; p.z = at.z; p.yaw = at.yaw || 0; p.fl = 0; p.dead = false;
    p.hpMax = hpMax(c.skills); p.hp = p.hpMax; p.zoneAt = ctx.now();
    z.players.add(p.pid);
    const msg = {
      t: 'joined', zone: zi, at: { x: at.x, y: at.y, z: at.z, yaw: at.yaw },
      players: [...z.players].filter(pid => pid !== p.pid).map(pid => ctx.pubPlayer(ctx.players.get(pid))),
      pickups: z.pickups.map(k => !k.taken),
      loots: [...z.loots.values()].map(l => ({ id: l.id, x: l.x, y: l.y, z: l.z, owners: [...l.owners] }))
    };
    ctx.bus.emit('zoneEnter', { p, z, msg });          // the AI adds NPCs, objective and authority
    ctx.send(p, msg);
    ctx.zoneSend(z, { t: 'pjoin', ...ctx.pubPlayer(p) }, p.pid);
    p.dirty = true;
  });
  ctx.bus.on('logout', p => leaveZone(p));

  /* ---- movement: client-authoritative, clamped ---- */
  ctx.bus.on('c:pos', ({ p, m }) => {
    if (p.zone < 0 || !vec3(m.p)) return;
    const [x, y, zz] = m.p;
    p.x = Math.max(-BOUND, Math.min(BOUND, x));
    p.y = Math.max(-10, Math.min(40, y));
    p.z = Math.max(-BOUND, Math.min(BOUND, zz));
    if (finite(m.yaw)) p.yaw = m.yaw;
    if (finite(m.pitch)) p.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
    const w = m.w | 0;
    if (w >= 0 && w < 4 && isUnlocked(p.char.skills, WEAPON_SKILL[w])) p.w = w;
    p.fl = (m.fl | 0) & 31;
    if (p.dead) p.fl |= 2;
  });
  ctx.bus.on('c:hp', ({ p, m }) => { if (finite(m.hp)) p.hp = Math.max(0, Math.min(p.hpMax, m.hp)); });
  ctx.bus.on('c:skill', ({ p, m }) => {          // the skill the player is training right now
    if (SKILLS[m.skill] && isUnlocked(p.char.skills, m.skill)) p.char.lastSkill = m.skill;
  });

  /* ---- death and respawn ---- */
  ctx.bus.on('c:died', ({ p }) => {
    if (p.dead || p.zone < 0) return;
    p.dead = true; p.hp = 0; p.fl |= 2;
    const c = p.char;
    c.stats.deaths++;
    const d = deathDebt(c.skills);
    if (d.add > 0){
      c.debt = Math.min(d.cap, c.debt + d.add);
      c.debtMax = c.debt;
    }
    p.respawnAt = ctx.now() + DEATH.respawnDelay;
    p.dirty = true;
    ctx.send(p, { t: 'death', debt: Math.ceil(c.debt), respawnIn: DEATH.respawnDelay });
    ctx.bus.emit('playerDied', p);
    pushChar(p);
  });

  /* ---- supplies ---- */
  ctx.bus.on('c:pickup', ({ p, m }) => {
    if (p.zone < 0 || p.dead) return;
    const z = ctx.zones[p.zone], k = m.k | 0, def = z.def.pickups[k], st = z.pickups[k];
    if (!def || st.taken) return;
    if (Math.hypot(p.x - def[1], p.z - def[2]) > 3) return;
    st.taken = true; st.at = ctx.now() + PICKUP_RESPAWN;
    if (def[0] === 'ammo') ctx.give(p, { ammo: true, nade: 1 }, 'pickup');
    else if (def[0] === 'med') ctx.give(p, { heal: 45 }, 'pickup');
    else ctx.give(p, { nade: 2 }, 'pickup');
    ctx.zoneSend(z, { t: 'pickup', k, on: false, by: p.pid });
  });
  ctx.bus.on('c:loot', ({ p, m }) => {
    if (p.zone < 0 || p.dead) return;
    const z = ctx.zones[p.zone], l = z.loots.get(m.id | 0);
    if (!l) return;
    if (Math.hypot(p.x - l.x, p.z - l.z) > 3.5) return;
    if (ctx.now() < l.rightsUntil && !l.owners.has(p.pid)){ ctx.sys(p, 'Hòm này còn thuộc về người hạ địch.'); return; }
    z.loots.delete(l.id);
    ctx.give(p, l.c, 'loot');
    ctx.zoneSend(z, { t: 'lootGone', id: l.id, by: p.pid });
    ctx.bus.emit('looted', { p, z });
  });

  /* ---- consumables and the quartermaster ---- */
  ctx.bus.on('c:use', ({ p, m }) => {
    if (m.item === 'bandage' && p.char.inv.bandage > 0 && !p.dead){
      p.char.inv.bandage--; p.dirty = true;
      ctx.send(p, { t: 'grant', healOver: 40, over: 4, inv: p.char.inv, money: p.char.money, reason: 'bandage' });
    }
  });
  ctx.bus.on('c:buy', ({ p, m }) => {
    const it = SHOP[m.item];
    if (!it || p.zone < 0) return;
    const sp = ctx.zones[p.zone].def.spawn;
    if (Math.hypot(p.x - sp.x, p.z - sp.z) > 9){ ctx.sys(p, 'Chỉ mua được ở trạm quân nhu tại điểm tập kết.'); return; }
    const c = p.char;
    if (c.money < it.price){ ctx.sys(p, 'Không đủ tiền.'); return; }
    if (it.max && c.inv[m.item] >= it.max){ ctx.sys(p, 'Đã mang tối đa.'); return; }
    c.money -= it.price;
    if (m.item === 'ammo') ctx.give(p, { ammo: true }, 'buy');
    else { c.inv[m.item]++; ctx.send(p, { t: 'grant', inv: c.inv, money: c.money, reason: 'buy' }); }
    p.dirty = true;
  });

  /* gunfire and grenades are relayed so everyone hears and sees them; the
     simulation owner also uses them to wake the defenders */
  ctx.bus.on('c:shot', ({ p, m }) => {
    if (p.zone < 0 || p.dead || !vec3(m.from) || !vec3(m.to)) return;
    const t = ctx.now();
    if (t - (p.lastShot || 0) < 0.05) return;
    p.lastShot = t;
    ctx.zoneSend(ctx.zones[p.zone], { t: 'shot', pid: p.pid, from: m.from.map(r2), to: m.to.map(r2), w: m.w | 0 }, p.pid);
  });
  ctx.bus.on('c:nade', ({ p, m }) => {
    if (p.zone < 0 || p.dead || !vec3(m.from) || !vec3(m.vel)) return;
    if (p.char.inv.nade <= 0){ ctx.send(p, { t: 'grant', inv: p.char.inv, money: p.char.money, reason: 'sync' }); return; }
    p.char.inv.nade--; p.dirty = true;
    ctx.send(p, { t: 'grant', inv: p.char.inv, money: p.char.money, reason: 'throw' });
    ctx.zoneSend(ctx.zones[p.zone], { t: 'nade', pid: p.pid, from: m.from.map(r2), vel: m.vel.map(r2) }, p.pid);
  });

  /* ---- timers ---- */
  ctx.bus.on('tick', tk => {
    const now = ctx.now();
    for (const p of ctx.players.values()){
      if (p.dead && p.respawnAt && now >= p.respawnAt && p.zone >= 0){
        const sp = ctx.zones[p.zone].def.spawn;
        p.dead = false; p.respawnAt = 0; p.fl &= ~2;
        p.x = sp.x; p.z = sp.z;
        p.hp = Math.round(p.hpMax * DEATH.respawnHp);
        ctx.send(p, { t: 'respawn', x: sp.x, z: sp.z, hp: p.hp });
      }
      /* the debt melts with time (death_penalties.cpp:99) */
      if (tk % 10 === 0 && p.char.debt > 0 && p.char.debtMax){
        p.char.debt = Math.max(0, p.char.debt - p.char.debtMax * 1 / DEATH.resorbSeconds);
      }
    }
    if (tk % 10) return;
    for (const z of ctx.zones){
      z.pickups.forEach((st, k) => {
        if (st.taken && now >= st.at){ st.taken = false; ctx.zoneSend(z, { t: 'pickup', k, on: true }); }
      });
      for (const l of z.loots.values()) if (now >= l.until){ z.loots.delete(l.id); ctx.zoneSend(z, { t: 'lootGone', id: l.id }); }
    }
  });
}
