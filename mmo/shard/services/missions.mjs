// Mission manager (Ryzom: entities_game_service/mission_manager). Steps
// mirror a few of Ryzom's MISSION_REGISTER_STEP keywords — kill, visit,
// loot_item — plus two the shooter needs (a kill with a given weapon, a
// headshot) and the zone objective. Kills count for every team member in the
// same zone, so a squad can run the same orders together.
import { MISSIONS } from '../zones.mjs';
import { bestSkill } from '../rules.mjs';

const BY_ID = new Map(MISSIONS.map(m => [m.id, m]));
const MAX_ACTIVE = 3;

export function installMissions(ctx){
  const view = (p) => {
    const c = p.char, now = ctx.now();
    const zone = p.zone;
    const avail = MISSIONS.filter(m => m.zone === zone).map(m => ({
      id: m.id, title: m.title, desc: m.desc, reward: m.reward, minLevel: m.minLevel || 1,
      active: !!c.missions.active[m.id], cooldown: Math.max(0, Math.ceil((c.missions.cd[m.id] || 0) - now))
    }));
    const active = Object.entries(c.missions.active).map(([id, st]) => {
      const m = BY_ID.get(id);
      return m && { id, title: m.title, zone: m.zone, step: st.step, steps: m.steps.map((s, k) => ({
        text: stepText(m, s), n: s.n || 1, done: k < st.step ? (s.n || 1) : (k === st.step ? st.count : 0) })) };
    }).filter(Boolean);
    return { t: 'missions', avail, active };
  };
  const stepText = (m, s) => {
    const site = s.site && require_site(m.zone, s.site);
    switch (s.type){
      case 'kill': return `Tiêu diệt ${s.n} quân địch`;
      case 'kill_weapon': return `Diệt ${s.n} địch bằng ${({ nade: 'lựu đạn', lmg: 'trung liên', sniper: 'súng bắn tỉa', smg: 'tiểu liên', pistol: 'súng ngắn' })[s.weapon]}`;
      case 'kill_head': return `${s.n} phát trúng đầu`;
      case 'loot': return `Nhặt ${s.n} hòm chiến lợi phẩm`;
      case 'visit': return `Tới ${site ? site.name : s.site}`;
      case 'capture': return m.zone === 2 ? 'Phá kho đạn' : 'Cắm cờ trên mục tiêu';
    }
    return s.type;
  };
  const require_site = (zone, key) => ctx.zones[zone].def.sites[key];

  ctx.bus.on('c:missions', ({ p }) => ctx.send(p, view(p)));
  ctx.bus.on('c:mission', ({ p, m }) => {
    const def = BY_ID.get(String(m.id)), c = p.char;
    if (!def) return;
    if (m.op === 'accept'){
      if (def.zone !== p.zone){ ctx.sys(p, 'Nhiệm vụ này thuộc chiến trường khác.'); return; }
      if (c.missions.active[def.id]) return;
      if (Object.keys(c.missions.active).length >= MAX_ACTIVE){ ctx.sys(p, `Chỉ nhận tối đa ${MAX_ACTIVE} nhiệm vụ cùng lúc.`); return; }
      if ((c.missions.cd[def.id] || 0) > ctx.now()){ ctx.sys(p, 'Nhiệm vụ này chưa thể nhận lại.'); return; }
      if (bestSkill(c.skills) < (def.minLevel || 1)){ ctx.sys(p, `Cần kỹ năng cao nhất đạt ${def.minLevel}.`); return; }
      c.missions.active[def.id] = { step: 0, count: 0 };
      ctx.sys(p, `Nhận nhiệm vụ: ${def.title}`);
    } else if (m.op === 'abandon'){
      delete c.missions.active[def.id];
    }
    p.dirty = true;
    ctx.send(p, view(p));
  });

  function advance(p, match){
    const c = p.char;
    let changed = false;
    for (const [id, st] of Object.entries(c.missions.active)){
      const def = BY_ID.get(id);
      if (!def){ delete c.missions.active[id]; continue; }
      if (def.zone !== p.zone) continue;
      const step = def.steps[st.step];
      if (!step || !match(step, def)) continue;
      st.count++;
      changed = true;
      if (st.count >= (step.n || 1)){
        st.step++; st.count = 0;
        if (st.step >= def.steps.length) complete(p, def);
      }
    }
    if (changed){ p.dirty = true; ctx.send(p, view(p)); }
  }
  function complete(p, def){
    const c = p.char;
    delete c.missions.active[def.id];
    c.missions.cd[def.id] = ctx.now() + (def.repeat || 0);
    ctx.send(p, { t: 'missionDone', id: def.id, title: def.title, reward: def.reward });
    const r = def.reward;
    if (r.xp) ctx.grantXp(p, c.lastSkill || 'smg', r.xp, 'mission');
    ctx.give(p, { money: r.money || 0, ...(r.items || {}) }, 'mission');
  }
  /* kills count for the killer and for teammates in the same zone */
  const squad = p => (p.team ? p.team.members.map(pid => ctx.players.get(pid)).filter(q => q && q.zone === p.zone) : [p]);

  ctx.bus.on('npcKilled', ({ killer, head, weapon }) => {
    if (!killer) return;
    for (const q of squad(killer)){
      const own = q === killer;
      advance(q, s => s.type === 'kill' || (own && s.type === 'kill_weapon' && s.weapon === weapon) || (own && s.type === 'kill_head' && head));
    }
  });
  ctx.bus.on('looted', ({ p }) => advance(p, s => s.type === 'loot'));
  ctx.bus.on('captured', ({ z, p }) => {
    for (const q of squad(p)) advance(q, s => s.type === 'capture');
    /* everyone on the hill when the flag goes up shares in it */
    for (const pid of z.players){
      const q = ctx.players.get(pid);
      if (q && !q.dead) ctx.grantXp(q, q.char.lastSkill || 'smg', q === p ? 120 : 60, 'capture');
    }
  });
  /* visits are checked from positions once a second */
  ctx.bus.on('tick', tk => {
    if (tk % 10) return;
    for (const p of ctx.players.values()){
      if (p.zone < 0 || p.dead) continue;
      const sites = ctx.zones[p.zone].def.sites;
      advance(p, s => {
        if (s.type !== 'visit') return false;
        const site = sites[s.site];
        return site && Math.hypot(p.x - site.x, p.z - site.z) <= site.r;
      });
    }
  });
  ctx.bus.on('zoneEnter', ({ p }) => ctx.send(p, view(p)));
}
