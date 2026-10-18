// Dev-only end-to-end run of the MMO mode. Not referenced by the game.
//
//   node tools/mmo-smoke.mjs
//
// Starts mmo/server.mjs on a spare port with a throw-away data directory, then
// drives real browser tabs against it (Playwright + software WebGL; set
// THREE_JS=/path/to/three.min.js (r128) when the machine cannot reach cdnjs):
//
//   two soldiers log in to Him Lam · the first owns the zone's AI, the second
//   follows it · each sees the other move · the second shoots a defender down
//   the crosshair and both screens agree he is dead, with XP paid · zone chat
//   and team chat · a team forms · death, XP debt screen, respawn · the owner
//   leaves and the zone is handed over · a reload resumes the session with the
//   character intact · the in-tab local shard logs in and marches to another
//   battlefield.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const three = process.env.THREE_JS ? fs.readFileSync(process.env.THREE_JS) : null;
const PORT = 8000 + Math.floor(Math.random() * 900);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dbp-shard-'));
const BASE = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Software WebGL in two browsers at once runs at a frame or two a second, so
   every check waits for its condition instead of for a fixed time. */
const until = (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);

const server = spawn(process.execPath, [path.join(root, 'mmo', 'server.mjs'), '--port', String(PORT), '--data', DATA, '--quiet'],
                     { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { server.stdout.once('data', res); server.once('exit', rej); });

/* one browser per soldier: tabs of one browser share a single software GPU,
   and a second tab never finishes loading while the first one is rendering */
const browsers = [];
const errors = [];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

async function open(tag, query = '?mmo=1&m=1'){
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 400, height: 225 } });
  page.on('pageerror', e => errors.push(tag + ': ' + e.message));
  if (three) await page.route('**/three.min.js', r => r.fulfill({ body: three, contentType: 'application/javascript' }));
  await page.goto(BASE + '/dienbienphu/' + query, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('boot').classList.contains('hide'), null, { timeout: 120000 });
  return page;
}
async function enter(page){
  await page.waitForFunction(() => MMO.inWorld, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.requestLock = () => {};
    window.__god = true;
    G.running = true; G.paused = false; UI.pause.classList.remove('on');
  });
}
async function login(page, name, how = 'ws'){
  await page.fill('#mmoName', name);
  await page.fill('#mmoPass', 'matkhau1');
  if (how === 'ws') await page.fill('#mmoUrl', `ws://localhost:${PORT}/shard`);
  await page.click(how === 'ws' ? '#mmoGo' : '#mmoLocal');
  await enter(page);
}
async function chat(page, text){
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

try {
  /* ---- two soldiers on Him Lam ---- */
  const A = await open('A'); await login(A, 'TrinhA');
  const B = await open('B'); await login(B, 'NguyenB');
  check('first soldier in owns the zone AI', await A.evaluate(() => MMO.owner && enemies.every(e => !e.puppet)));
  check('second soldier follows it', await B.evaluate(() => !MMO.owner && enemies.every(e => e.puppet)));

  /* each sees the other */
  const bPos = await B.evaluate(() => { player.pos.set(SPAWN.x + 3, terrainH(SPAWN.x + 3, SPAWN.z - 2), SPAWN.z - 2); return { x: player.pos.x, z: player.pos.z }; });
  await until(A, b => { const r = [...MMO.remotes.values()][0]; return r && Math.hypot(r.obj.position.x - b.x, r.obj.position.z - b.z) < 0.6; }, bPos);
  const seen = await A.evaluate(() => { const r = [...MMO.remotes.values()][0]; return r && { name: r.name, x: +r.obj.position.x.toFixed(2), z: +r.obj.position.z.toFixed(2) }; });
  check('the owner sees the second soldier where he stands', seen && seen.name === 'NguyenB' && Math.hypot(seen.x - bPos.x, seen.z - bPos.z) < 0.6, { seen, bPos });

  /* the follower's defenders track the owner's */
  await sleep(2500);
  const drift = await Promise.all([A, B].map(p => p.evaluate(() => enemies.map(e => [e.obj.position.x, e.obj.position.z]))));
  const worst = Math.max(...drift[0].map((a, i) => Math.hypot(a[0] - drift[1][i][0], a[1] - drift[1][i][1])));
  check('defenders agree on both screens', worst < 1.6, { worstMetres: +worst.toFixed(2) });

  /* B shoots one down the crosshair; the shard decides and both screens agree */
  const target = await A.evaluate(() => { const e = enemies.find(x => !x.dead); e.idleT = 999; return e.idx; });
  let killed = false;
  for (let tries = 0; tries < 30 && !killed; tries++){
    killed = await B.evaluate(i => {
      const e = enemies[i], p = e.obj.position;
      if (e.dead) return true;
      let spot = null;
      for (let a = 0; a < 24 && !spot; a++){
        const ang = a / 24 * Math.PI * 2, x = p.x + Math.cos(ang) * 5, z = p.z + Math.sin(ang) * 5;
        if (Math.abs(x) > 28 || Math.abs(z) > 28) continue;
        const y = terrainH(x, z);
        if (blocked(x, z, y + 0.3, y + 1.6, 0.4)) continue;
        const eye = new THREE.Vector3(x, y + 1.58, z), tgt = new THREE.Vector3(p.x, p.y + 1.2, p.z);
        const dir = tgt.clone().sub(eye), d = dir.length();
        if (new THREE.Raycaster(eye, dir.normalize(), 0, d - 0.3).intersectObjects(worldSolid, false).length) continue;
        spot = [x, z];
      }
      if (!spot) return false;
      player.pos.set(spot[0], terrainH(spot[0], spot[1]), spot[1]);
      const eye = new THREE.Vector3(spot[0], player.pos.y + 1.58, spot[1]);
      const d = new THREE.Vector3(p.x, p.y + 1.2, p.z).sub(eye);
      player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      player.recoilPitch = player.recoilYaw = 0;
      updatePlayer(0.001);
      player.fireCooldown = 0; WEAPONS[player.weapon].spread = WEAPONS[player.weapon].spreadBase;
      WEAPONS[player.weapon].mag = WEAPONS[player.weapon].magSize;
      fireWeapon();
      return false;
    }, target);
    await sleep(160);
  }
  await until(A, i => enemies[i].dead, target);
  const deadA = await A.evaluate(i => enemies[i].dead, target);
  const deadB = await B.evaluate(i => enemies[i].dead, target);
  const xpB = await B.evaluate(() => MMO.char.skills.smg.xp + (MMO.char.skills.smg.lv - 1) * 1000);
  check('a hit claimed by B kills the defender on both screens', deadA && deadB, { deadA, deadB });
  check('the kill pays B weapon-skill XP', xpB > 0, { xpB });
  check('the kill feed on the owner names the killer', await until(A, () => /NguyenB/i.test(document.getElementById('feed').textContent), null, 5000));

  /* chat, then a team */
  await chat(A, 'Tiến lên, các đồng chí!');
  check('zone chat reaches the other soldier', await until(B, () => document.getElementById('chatLog').textContent.includes('Tiến lên, các đồng chí!')));
  await chat(A, '/moi NguyenB');
  await until(B, () => MMO.lastInvite === 'TrinhA');
  await chat(B, '/dongy');
  await until(A, () => MMO.team.length === 2);
  await until(B, () => MMO.team.length === 2);
  const teams = await Promise.all([A, B].map(p => p.evaluate(() => MMO.team.length)));
  check('a team of two forms', teams[0] === 2 && teams[1] === 2, { teams });
  await chat(B, '/t rõ!');
  check('team chat arrives', await until(A, () => [...document.querySelectorAll('#chatLog .c-team')].some(d => d.textContent.includes('rõ!'))));

  /* death and respawn */
  await B.evaluate(() => { window.__god = false; damagePlayer(9999, player.pos); });
  check('death shows the fallen screen', await B.evaluate(() => player.dead && document.getElementById('mmoDeath').classList.contains('on')));
  await until(B, () => !player.dead, null, 20000);
  const back = await B.evaluate(() => ({ dead: player.dead, hp: Math.round(player.hp), max: player.hpMax, nearSpawn: Math.hypot(player.pos.x - SPAWN.x, player.pos.z - SPAWN.z) < 2 }));
  check('respawn at the rally point at half strength', !back.dead && back.nearSpawn && back.hp === Math.round(back.max / 2), back);
  await B.evaluate(() => { window.__god = true; });

  /* the owner leaves: the zone is handed over */
  await A.context().browser().close();
  check('the zone is handed to the soldier still in it', await until(B, () => MMO.owner && enemies.every(e => !e.puppet)));
  check('the new owner sees nobody else', await until(B, () => MMO.remotes.size === 0));

  /* a reload resumes the session; the character kept its XP */
  await B.reload({ waitUntil: 'load' });
  await B.waitForFunction(() => document.getElementById('boot').classList.contains('hide'), null, { timeout: 120000 });
  await enter(B);
  const xpB2 = await B.evaluate(() => MMO.char.skills.smg.xp + (MMO.char.skills.smg.lv - 1) * 1000);
  check('a reload resumes the session with the character intact', xpB2 === xpB, { before: xpB, after: xpB2 });
  await B.context().browser().close();

  /* the in-tab shard, then a march to Độc Lập */
  const C = await open('C', '?mmo=1&m=1');
  await login(C, 'DoanC', 'local');
  check('the local shard runs in the tab', await C.evaluate(() => MMO.owner && LEVEL_IDX === 0));
  await C.keyboard.press('KeyM');
  await C.click('button[data-act="travel"][data-id="1"]');
  await C.waitForURL(/m=2/, { timeout: 10000 });
  await C.waitForFunction(() => document.getElementById('boot').classList.contains('hide'), null, { timeout: 120000 });
  await enter(C);
  check('marching to Độc Lập re-enters as the same soldier', await C.evaluate(() => LEVEL_IDX === 1 && MMO.char.name === 'DoanC'));
  await C.context().browser().close();

  /* the shard wrote characters to disk */
  const files = fs.readdirSync(path.join(DATA, 'char'));
  check('characters are saved by the shard', files.includes('trinha.json') && files.includes('nguyenb.json'), files);
} catch (err){
  console.log('FAIL exception ' + (err && err.stack || err));
  results.push({ ok: false });
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  server.kill('SIGINT');
}
check('no page errors', !errors.length, errors.slice(0, 5));
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
