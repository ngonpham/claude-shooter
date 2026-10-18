// Chat (Ryzom: input_output_service, game_share/chat_group.h). say and shout
// reach 1 and 3 GPM cells of 16 m measured per axis (input_output_service.cpp
// MaxDistSay / MaxDistShout, chat_client.cpp), team goes to the team, region
// to the battlefield, universe to the shard, tell to one person.
import { CHAT } from '../rules.mjs';

const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, CHAT.maxLen);

export function installChat(ctx){
  const cellOf = v => Math.floor(v / CHAT.cell);
  const within = (a, b, cells) => a.zone === b.zone && Math.abs(cellOf(a.x) - cellOf(b.x)) <= cells && Math.abs(cellOf(a.z) - cellOf(b.z)) <= cells;

  ctx.bus.on('c:chat', ({ p, m }) => {
    const text = clean(m.text);
    if (!text) return;
    const now = ctx.now();
    p.chatTimes = (p.chatTimes || []).filter(t => now - t < 1);
    if (p.chatTimes.length >= CHAT.floodPerSec){ ctx.sys(p, 'Gửi chậm lại một chút.'); return; }
    p.chatTimes.push(now);
    const ch = String(m.ch || 'say');
    const msg = { t: 'chat', ch, from: p.name, pid: p.pid, text };
    let to = [];
    if (ch === 'say' || ch === 'shout'){
      const cells = ch === 'say' ? CHAT.say : CHAT.shout;
      to = [...ctx.players.values()].filter(q => q.zone >= 0 && within(p, q, cells));
    } else if (ch === 'region'){
      to = [...ctx.players.values()].filter(q => q.zone === p.zone);
    } else if (ch === 'universe'){
      to = [...ctx.players.values()];
    } else if (ch === 'team'){
      if (!p.team){ ctx.sys(p, 'Bạn chưa ở trong tổ đội nào.'); return; }
      to = p.team.members.map(pid => ctx.players.get(pid)).filter(Boolean);
    } else if (ch === 'tell'){
      const q = ctx.byName.get(String(m.to || '').trim().toLowerCase());
      if (!q){ ctx.sys(p, 'Người chơi không trực tuyến.'); return; }
      msg.to = q.name;
      to = q === p ? [p] : [q, p];
    } else return;
    for (const q of to) ctx.send(q, msg);
  });

  ctx.bus.on('c:who', ({ p }) => {
    ctx.send(p, { t: 'who', list: [...ctx.players.values()].map(q => ({ name: q.name, zone: q.zone, rank: ctx.charView(q).rank })) });
  });
  ctx.bus.on('login', p => {
    for (const q of ctx.players.values()) if (q !== p) ctx.send(q, { t: 'sys', text: `${p.name} đã vào máy chủ.` });
  });
}
