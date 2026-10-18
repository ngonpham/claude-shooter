// Backup service (Ryzom: backup_service). The EGS saves a character every
// TickFrequencyPCSave = 100 ticks (character.cpp, egs_variables.cpp) and on
// disconnect; here a dirty character is written on the same cadence through
// the host's store, which is a JSON file per character under Node and
// localStorage in the browser.
export function installBackup(ctx){
  function save(p){
    const c = p.char;
    if (p.zone >= 0 && !p.dead) c.pos = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(p.yaw * 100) / 100 };
    const now = ctx.now();
    c.stats.played = (c.stats.played || 0) + Math.max(0, now - (p.savedAt || p.joinedAt));
    p.savedAt = now;
    try { ctx.store.save('char/' + p.key, c); p.dirty = false; }
    catch (e){ ctx.log('backup failed', p.name, e && e.message); }
  }
  ctx.bus.on('tick', tk => {
    if (tk % 100) return;
    for (const p of ctx.players.values()) save(p);
  });
  ctx.bus.on('logout', save);
  ctx.bus.on('saveAll', () => { for (const p of ctx.players.values()) save(p); });
  ctx.bus.on('shutdown', () => { for (const p of ctx.players.values()) save(p); });
}
