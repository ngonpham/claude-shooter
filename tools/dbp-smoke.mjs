// Dev-only regression run for dienbienphu/index.html. Not referenced by the game.
//
//   node tools/dbp-smoke.mjs            # all five battles
//   node tools/dbp-smoke.mjs 2,4        # just Độc Lập and A1
//
// Needs Playwright with a Chromium build. Software WebGL is enough: nothing here
// measures frame rate. Set THREE_JS=/path/to/three.min.js (r128) to serve
// three.js from disk when the machine has no route to cdnjs.
//
// For each level it loads the page, starts the battle without pointer lock, and
// checks that: the page throws nothing; every patrol starts on reachable ground;
// a rifle aimed down the crosshair kills a man; a grenade at a man's feet kills
// him; clearing the roster unlocks the objective; holding E at the objective
// plants the flag (or arms the charge, on the airfield).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const page_url = url.pathToFileURL(path.join(root, 'dienbienphu', 'index.html')).href;
const levels = (process.argv[2] || '1,2,3,4,5').split(',').map(Number);
const three = process.env.THREE_JS ? fs.readFileSync(process.env.THREE_JS) : null;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
let failed = 0;
for (const m of levels){
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  if (three) await page.route('**/three.min.js', r => r.fulfill({ body: three, contentType: 'application/javascript' }));
  await page.goto(page_url + '?m=' + m, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot').classList.contains('hide')
                               || document.getElementById('err').textContent.length > 0, null, { timeout: 120000 });

  const r = await page.evaluate(() => {
    window.requestLock = () => {};
    startGame(); G.running = true; window.__god = true;
    const out = { level: LV.name };
    out.unreachable = enemies.filter(e => !walkable(e.obj.position.x, e.obj.position.z)).map(e => e.name);

    /* one man, shot down the crosshair from a clear spot a few metres away */
    const e = enemies[0], p = e.obj.position;
    e.state = ST.PATROL; e.idleT = 99;
    let spot = null;
    for (let a = 0; a < 24 && !spot; a++){
      const ang = a / 24 * Math.PI * 2, x = p.x + Math.cos(ang) * 6, z = p.z + Math.sin(ang) * 6;
      if (Math.abs(x) > 28 || Math.abs(z) > 28) continue;
      const y = terrainH(x, z);
      if (blocked(x, z, y + 0.3, y + 1.6, 0.4)) continue;
      const eye = new THREE.Vector3(x, y + 1.58, z), tgt = new THREE.Vector3(p.x, p.y + 1.2, p.z);
      const dir = tgt.clone().sub(eye), d = dir.length();
      const ray = new THREE.Raycaster(eye, dir.normalize(), 0, d - 0.3);
      if (ray.intersectObjects(worldSolid, false).length) continue;
      spot = [x, z];
    }
    if (spot){
      player.pos.set(spot[0], terrainH(spot[0], spot[1]), spot[1]);
      for (let i = 0; i < 8 && !e.dead; i++){
        const eye = new THREE.Vector3(spot[0], player.pos.y + 1.58, spot[1]);
        const d = new THREE.Vector3(p.x, p.y + 1.2, p.z).sub(eye);
        player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        player.recoilPitch = player.recoilYaw = 0;
        updatePlayer(0.001);
        player.fireCooldown = 0; WEAPONS[player.weapon].spread = WEAPONS[player.weapon].spreadBase;
        fireWeapon();
      }
    }
    out.shot = spot ? e.dead : 'no clear spot';

    /* a grenade at the next man's feet */
    const e2 = enemies.find(x => !x.dead), q = e2.obj.position;
    const n = throwNade(new THREE.Vector3(q.x + 0.4, q.y + 0.6, q.z + 0.4), new THREE.Vector3(), 'player');
    for (let i = 0; i < 260 && n.live; i++) updateNades(1 / 60);
    out.grenade = e2.dead;

    /* clear the rest, walk onto the objective, hold E */
    for (const x of enemies) if (!x.dead) damageEnemy(x, 999, false, new THREE.Vector3(0, 0, 1), x.obj.position);
    out.unlocked = G.objUnlocked;
    player.pos.set(OBJ.x + 0.6, OBJ.y + 0.05, OBJ.z + 0.3); player.vel.set(0, 0, 0);
    keys['KeyE'] = true;
    for (let i = 0; i < 60 * (OBJ.hold + 1); i++) updatePlayer(1 / 60);
    keys['KeyE'] = false;
    out.objective = OBJ.type === 'charge' ? !!G.chargeArmed : G.objectiveDone;
    return out;
  });
  const ok = !errs.length && !r.unreachable.length && r.shot === true && r.grenade && r.unlocked && r.objective;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + m + ' ' + JSON.stringify(r) + (errs.length ? ' errors: ' + errs.join(' | ') : ''));
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
