// Welcome / login service (Ryzom: ryzom_welcome_service + the login side of
// the EGS player manager). Accounts are created on first login; a character
// name is the account. A resume token lets the client reconnect after the
// page reload that moving between battlefields requires.
import { START, SKILLS } from '../rules.mjs';

const NAME_RE = /^[\p{L}\p{N}_]{3,16}$/u;
const TOKEN_TTL = 24 * 3600;

export function newCharacter(name, key){
  const skills = {};
  for (const id in SKILLS) skills[id] = { lv: 1, xp: 0 };
  return {
    v: 1, name, key, salt: '', hash: '', created: 0,
    money: START.money, inv: { ...START.inv }, skills, debt: 0, debtAt: 0,
    zone: 0, pos: null, lastSkill: 'smg',
    missions: { active: {}, cd: {} },
    stats: { kills: 0, heads: 0, deaths: 0, captures: 0, played: 0 }
  };
}

export function installLogin(ctx){
  const tokens = new Map();       // token -> { key, until }

  function admit(session, char){
    const key = char.key;
    const old = ctx.byName.get(key);
    if (old){
      /* one session per character: the newest wins, the old one is told why */
      ctx.send(old, { t: 'kicked', text: 'Nhân vật vừa đăng nhập ở nơi khác.' });
      ctx.bus.emit('logout', old);
      if (old.session) old.session.player = null;
      char = old.char;                                // keep what the old session had not saved yet
    }
    const token = ctx.auth.token();
    tokens.set(token, { key, until: ctx.now() + TOKEN_TTL });
    const p = {
      pid: ctx.nextPid++, name: char.name, key, char, session, out: session.out, online: true,
      zone: -1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fl: 0, w: 0,
      hp: 100, hpMax: 100, dead: false, team: null, joinedAt: ctx.now(), dirty: true
    };
    session.player = p;
    ctx.players.set(p.pid, p);
    ctx.byName.set(key, p);
    ctx.bus.emit('login', p);
    ctx.send(p, { t: 'welcome', pid: p.pid, token, local: ctx.local, char: ctx.charView(p), zones: ctx.zoneList() });
    ctx.log('login', p.name, 'pid', p.pid);
  }

  ctx.bus.on('c:login', ({ session, m }) => {
    const name = String(m.name || '').trim().normalize('NFC');
    const pass = String(m.pass || '');
    if (!NAME_RE.test(name)){
      session.out({ t: 'loginFail', text: 'Tên 3–16 ký tự: chữ, số hoặc dấu gạch dưới.' }); return;
    }
    if (!ctx.local && pass.length < 4){
      session.out({ t: 'loginFail', text: 'Mật khẩu cần ít nhất 4 ký tự.' }); return;
    }
    const key = name.toLowerCase();
    let char = ctx.store.load('char/' + key);
    if (!char){
      char = newCharacter(name, key);
      char.created = ctx.now();
      if (!ctx.local){ char.salt = ctx.auth.token(); char.hash = ctx.auth.hash(pass, char.salt); }
      ctx.store.save('char/' + key, char);
      ctx.log('new character', name);
    } else if (!ctx.local && ctx.auth.hash(pass, char.salt) !== char.hash){
      session.out({ t: 'loginFail', text: 'Sai mật khẩu cho nhân vật này.' }); return;
    }
    admit(session, char);
  });

  ctx.bus.on('c:resume', ({ session, m }) => {
    const rec = tokens.get(String(m.token || ''));
    if (!rec || rec.until < ctx.now()){ session.out({ t: 'loginFail', text: 'Phiên đã hết hạn, hãy đăng nhập lại.', expired: true }); return; }
    const online = ctx.byName.get(rec.key);
    const char = online ? online.char : ctx.store.load('char/' + rec.key);
    if (!char){ session.out({ t: 'loginFail', text: 'Không tìm thấy nhân vật.', expired: true }); return; }
    tokens.delete(String(m.token));
    admit(session, char);
  });

  ctx.bus.on('logout', p => {
    if (!p.online) return;
    p.online = false;
    ctx.players.delete(p.pid);
    if (ctx.byName.get(p.key) === p) ctx.byName.delete(p.key);
    ctx.log('logout', p.name);
  });

  ctx.bus.on('tick', t => {
    if (t % 600) return;
    const now = ctx.now();
    for (const [k, v] of tokens) if (v.until < now) tokens.delete(k);
  });
}
