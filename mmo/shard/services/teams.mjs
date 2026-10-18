// Team manager (Ryzom: entities_game_service/team_manager). Up to nine
// (game_share/misc_const.h TeamMaxNbMembers), session-only like Ryzom's
// teams, with a once-a-second status frame for every member.
import { TEAM_MAX } from '../rules.mjs';

export function installTeams(ctx){
  let seq = 0;
  const findByName = name => ctx.byName.get(String(name || '').trim().toLowerCase());

  function frame(team){
    const members = team.members.map(pid => ctx.players.get(pid)).filter(Boolean).map(q => ({
      pid: q.pid, name: q.name, hp: Math.round(q.hp), hpMax: q.hpMax, zone: q.zone, dead: q.dead, leader: q.pid === team.leader }));
    for (const m of members){ const q = ctx.players.get(m.pid); if (q) ctx.send(q, { t: 'team', id: team.id, members }); }
  }
  function leave(p){
    const team = p.team;
    if (!team) return;
    team.members = team.members.filter(pid => pid !== p.pid);
    p.team = null;
    ctx.send(p, { t: 'team', id: 0, members: [] });
    if (team.members.length <= 1){
      for (const pid of team.members){ const q = ctx.players.get(pid); if (q){ q.team = null; ctx.send(q, { t: 'team', id: 0, members: [] }); ctx.sys(q, 'Tổ đội đã giải tán.'); } }
      return;
    }
    if (team.leader === p.pid) team.leader = team.members[0];
    for (const pid of team.members){ const q = ctx.players.get(pid); if (q) ctx.sys(q, `${p.name} đã rời tổ đội.`); }
    frame(team);
  }
  ctx.teamFrame = frame;

  ctx.bus.on('c:team', ({ p, m }) => {
    if (m.op === 'invite'){
      const q = findByName(m.name);
      if (!q || q === p){ ctx.sys(p, 'Không tìm thấy người chơi đó.'); return; }
      if (q.team){ ctx.sys(p, `${q.name} đã ở trong một tổ đội.`); return; }
      if (p.team && p.team.leader !== p.pid){ ctx.sys(p, 'Chỉ tổ trưởng được mời.'); return; }
      if (p.team && p.team.members.length >= TEAM_MAX){ ctx.sys(p, `Tổ đội tối đa ${TEAM_MAX} người.`); return; }
      (q.invites || (q.invites = new Map())).set(p.pid, ctx.now() + 60);
      ctx.send(q, { t: 'teamInvite', from: p.name });
      ctx.sys(p, `Đã mời ${q.name}.`);
    } else if (m.op === 'accept'){
      const q = findByName(m.name);
      if (!q || !p.invites || !(p.invites.get(q.pid) > ctx.now())){ ctx.sys(p, 'Lời mời không còn hiệu lực.'); return; }
      p.invites.delete(q.pid);
      if (p.team) leave(p);
      let team = q.team;
      if (!team){ team = { id: ++seq, leader: q.pid, members: [q.pid] }; q.team = team; }
      if (team.members.length >= TEAM_MAX){ ctx.sys(p, 'Tổ đội đã đủ người.'); return; }
      team.members.push(p.pid); p.team = team;
      for (const pid of team.members){ const r = ctx.players.get(pid); if (r) ctx.sys(r, `${p.name} đã vào tổ đội.`); }
      frame(team);
    } else if (m.op === 'leave'){
      leave(p);
    } else if (m.op === 'kick'){
      const q = findByName(m.name);
      if (!p.team || p.team.leader !== p.pid || !q || q.team !== p.team) return;
      ctx.sys(q, 'Bạn đã bị mời ra khỏi tổ đội.');
      leave(q);
    }
  });
  ctx.bus.on('logout', p => leave(p));
  ctx.bus.on('tick', tk => {
    if (tk % 10) return;
    const seen = new Set();
    for (const p of ctx.players.values()) if (p.team && !seen.has(p.team)){ seen.add(p.team); frame(p.team); }
  });
}
