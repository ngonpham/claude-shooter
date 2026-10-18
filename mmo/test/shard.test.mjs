// node --test mmo/test
// Drives the shard with scripted clients: no sockets, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShard } from '../shard/shard.mjs';
import { ZONES } from '../shard/zones.mjs';
import { xpFactor, hpMax, npcHp } from '../shard/rules.mjs';

function makeShard(){
  const disk = new Map();
  let t = 1000;
  const store = { load: k => (disk.has(k) ? JSON.parse(disk.get(k)) : null), save: (k, d) => disk.set(k, JSON.stringify(d)) };
  const auth = { hash: (p, s) => 'h' + p + s, token: () => Math.random().toString(36).slice(2) };
  const shard = createShard({ store, auth, now: () => t, random: () => 0.1 });
  const clock = { advance(sec){ for (let i = 0; i < Math.round(sec * 10); i++){ t += 0.1; shard.tick(); } } };
  return { shard, disk, clock };
}
function client(shard, name, pass = 'pass1'){
  const inbox = [];
  const conn = shard.connect(m => inbox.push(JSON.parse(JSON.stringify(m))));
  const c = {
    inbox, send: m => conn.receive(m), close: () => conn.close(),
    last: t => [...inbox].reverse().find(m => m.t === t),
    all: t => inbox.filter(m => m.t === t),
    clear(){ inbox.length = 0; }
  };
  c.send({ t: 'login', name, pass });
  c.pid = c.last('welcome') && c.last('welcome').pid;
  return c;
}

test('zone data matches the client battlefields', () => {
  assert.deepEqual(ZONES.map(z => z.npcs), [10, 12, 12, 14, 14]);
  assert.deepEqual(ZONES.map(z => z.pickups.length), [6, 6, 6, 7, 7]);
});

test('rules follow the Ryzom shapes', () => {
  assert.equal(hpMax({ smg: { lv: 1 } }), 100);                    // (0 + 10) * 10
  assert.ok(xpFactor(1, 5) > xpFactor(5, 5));                      // harder targets pay more
  assert.equal(xpFactor(40, 10), 0);                               // far too easy pays nothing
  assert.ok(npcHp(10) > npcHp(1));
});

test('login, wrong password, resume token', () => {
  const { shard } = makeShard();
  const a = client(shard, 'Giot');
  assert.ok(a.last('welcome'));
  const bad = client(shard, 'Giot', 'nope1');
  assert.ok(bad.last('loginFail'));
  const token = a.last('welcome').token;
  const r = { inbox: [] };
  const conn = shard.connect(m => r.inbox.push(m));
  conn.receive({ t: 'resume', token });
  assert.equal(r.inbox.at(-1).t, 'welcome');
  assert.equal(a.last('kicked').t, 'kicked');                     // one session per character
});

test('first in a zone simulates it; the owner hands over on leave', () => {
  const { shard } = makeShard();
  const a = client(shard, 'Anh'), b = client(shard, 'Binh');
  a.send({ t: 'join', zone: 0 });
  assert.equal(a.last('joined').authority, true);
  b.send({ t: 'join', zone: 0 });
  assert.equal(b.last('joined').authority, false);
  b.clear();
  a.close();
  assert.equal(b.last('authority').on, true);
  assert.equal(b.last('authority').npcs.length, 10);
});

test('hits are judged, kills pay XP, drop loot and open the objective', () => {
  const { shard, clock } = makeShard();
  const a = client(shard, 'Dien');
  a.send({ t: 'join', zone: 0 });
  a.send({ t: 'pos', p: [0, 0, 10], yaw: 0, w: 0, fl: 0 });
  const npcs = a.last('joined').npcs;
  /* an impossible hit is ignored */
  a.send({ t: 'hit', i: 0, dmg: 5000, w: 0, gen: 0 });
  const after = a.last('npcHp');
  assert.ok(!after || after.hp >= npcs[0].hpMax - 60.5);
  for (const n of npcs){
    let guard = 0;
    while (guard++ < 40){
      a.send({ t: 'hit', i: n.i, dmg: 60, head: 1, w: 0, gen: n.gen });
      clock.advance(0.2);
      if (a.all('npcDie').some(d => d.i === n.i)) break;
    }
  }
  assert.equal(a.all('npcDie').length, 10);
  assert.ok(a.all('xp').length > 0);
  assert.ok(a.all('loot').length > 0);
  assert.equal(a.last('objective').state, 'open');
  /* loot */
  const l = a.last('loot');
  a.send({ t: 'pos', p: [l.x, l.y, l.z], yaw: 0, w: 0, fl: 0 });
  a.send({ t: 'loot', id: l.id });
  assert.ok(a.all('grant').some(g => g.reason === 'loot'));
  /* plant */
  const o = ZONES[0].objective;
  a.send({ t: 'pos', p: [o.x, 6, o.z], yaw: 0, w: 0, fl: 0 });
  a.send({ t: 'plant' });
  assert.equal(a.last('objective').state, 'captured');
  clock.advance(61);
  assert.equal(a.last('objective').state, 'locked');
  assert.equal(a.all('npcSpawn').length, 10);
});

test('team XP is shared and divided, team chat reaches the team only', () => {
  const { shard } = makeShard();
  const a = client(shard, 'Lam'), b = client(shard, 'Son'), c = client(shard, 'Tung');
  for (const x of [a, b, c]){ x.send({ t: 'join', zone: 0 }); x.send({ t: 'pos', p: [0, 0, 0], yaw: 0, w: 0, fl: 0 }); }
  a.send({ t: 'team', op: 'invite', name: 'Son' });
  b.send({ t: 'team', op: 'accept', name: 'Lam' });
  assert.equal(b.last('team').members.length, 2);
  c.clear();
  a.send({ t: 'chat', ch: 'team', text: 'tiến lên' });
  assert.equal(b.last('chat').text, 'tiến lên');
  assert.equal(c.last('chat'), undefined);
  const n = a.last('joined').npcs[0];
  for (let k = 0; k < 10 && !a.last('npcDie'); k++) a.send({ t: 'hit', i: n.i, dmg: 60, w: 0, gen: n.gen });
  const xa = a.last('xp'), xb = b.last('xp');
  assert.ok(xa && xb && xa.gain === xb.gain);                      // split evenly, both paid
});

test('death adds an XP debt only past skill 10, and respawn follows', () => {
  const { shard, clock } = makeShard();
  const a = client(shard, 'Hai');
  a.send({ t: 'join', zone: 0 });
  a.send({ t: 'died' });
  assert.equal(a.last('death').debt, 0);
  clock.advance(7);
  assert.ok(a.last('respawn'));
  const p = shard.ctx.byName.get('hai');
  p.char.skills.smg.lv = 12;
  a.send({ t: 'died' });
  assert.ok(a.last('death').debt > 0);
});

test('missions: accept, visit steps, completion pays', () => {
  const { shard, clock } = makeShard();
  const a = client(shard, 'Tran');
  a.send({ t: 'join', zone: 0 });
  a.send({ t: 'mission', op: 'accept', id: 'hl_recon' });
  const s = ZONES[0].sites;
  a.send({ t: 'pos', p: [s.k3.x, 0, s.k3.z], yaw: 0, w: 0, fl: 0 }); clock.advance(1.1);
  a.send({ t: 'pos', p: [s.k2.x, 0, s.k2.z], yaw: 0, w: 0, fl: 0 }); clock.advance(1.1);
  assert.equal(a.last('missionDone').id, 'hl_recon');
});

test('characters persist across logins', () => {
  const { shard, disk } = makeShard();
  const a = client(shard, 'VoThi');
  a.send({ t: 'join', zone: 1 });
  a.send({ t: 'pos', p: [5, 1, 6], yaw: 1, w: 0, fl: 0 });
  a.close();
  const saved = JSON.parse(disk.get('char/vothi'));
  assert.equal(saved.zone, 1);
  assert.equal(saved.pos.x, 5);
  const b = client(shard, 'VoThi');
  b.send({ t: 'join', zone: 1 });
  assert.equal(b.last('joined').at.x, 5);
});

test('frontend sends near entities first under a tight budget', () => {
  const { shard, clock } = makeShard();
  const viewer = client(shard, 'Nhin');
  const others = ['Mot', 'Hai2', 'Bay'].map(n => client(shard, n));
  viewer.send({ t: 'join', zone: 2 });
  for (const o of others) o.send({ t: 'join', zone: 2 });
  viewer.send({ t: 'pos', p: [0, 0, 0], yaw: 0, w: 0, fl: 0 });
  others.forEach((o, i) => o.send({ t: 'pos', p: [2 + i * 12, 0, 0], yaw: 0, w: 0, fl: 0 }));
  shard.ctx.zones[2].authority = viewer.pid;                     // keep NPCs out of this test
  clock.advance(0.1);
  const snap = viewer.last('snap');
  assert.ok(snap.p.length === 3);
});
