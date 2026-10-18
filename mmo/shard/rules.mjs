// Game rules for the shard, modelled on Ryzom Core's entities_game_service.
//
// Each rule notes the Ryzom source it follows. Paths are relative to
// ryzomcore/ryzom/. Where Ryzom keeps its numbers in level-design sheets that
// are not in the open-source repository (the success/XP table, skill-tree
// caps), the numbers here are our own and are marked as such.

/* tick_service.cpp: _TickTimeStep = 0.1f — the whole shard runs at 10 Hz */
export const TICK_MS = 100;

/* --------------------------------------------------------------------------
   Skills. Ryzom has no character level: every action trains the skill it used
   (SSkill.Base/Xp/XpNextLvl, entity_structure/statistic.h) and a branch opens
   its children once it reaches the node's cap (character.cpp ~7349-7510).
   Here the tree is one level deep and the unlock thresholds are ours.
   ------------------------------------------------------------------------- */
export const SKILLS = {
  smg:    { name: 'Tiểu liên',  weapon: 0, unlock: null },
  pistol: { name: 'Súng ngắn',  weapon: 2, unlock: null },
  nade:   { name: 'Lựu đạn',    weapon: -1, unlock: null },
  lmg:    { name: 'Trung liên', weapon: 1, unlock: { smg: 8 } },
  sniper: { name: 'Bắn tỉa',    weapon: 3, unlock: { smg: 12, pistol: 10 } }   // either one opens it
};
export const SKILL_MAX = 50;
export const WEAPON_SKILL = ['smg', 'lmg', 'pistol', 'sniper'];

export function xpForNext(lv){ return Math.round(60 * Math.pow(lv, 1.35)); }

export function isUnlocked(skills, id){
  const u = SKILLS[id].unlock;
  if (!u) return true;
  return Object.entries(u).some(([k, v]) => (skills[k] ? skills[k].lv : 0) >= v);
}

export function bestSkill(skills){
  let b = 1;
  for (const k in skills) if (skills[k].lv > b) b = skills[k].lv;
  return b;
}

/* Rank is cosmetic, derived from the best skill like Ryzom's titles */
export const RANKS = [[1,'Chiến sĩ mới'],[5,'Chiến sĩ'],[10,'Tiểu đội phó'],[15,'Tiểu đội trưởng'],
                      [20,'Trung đội phó'],[25,'Trung đội trưởng'],[32,'Đại đội phó'],[40,'Đại đội trưởng']];
export function rankOf(best){ let r = RANKS[0][1]; for (const [lv, n] of RANKS) if (best >= lv) r = n; return r; }

/* --------------------------------------------------------------------------
   Scores. character.cpp:2341 — max score = (charac + 10) * 10, with the
   base value and factor both 10 (egs_variables.cpp:669-670). The characteristic
   here grows with the best skill (one point per three levels; our choice).
   ------------------------------------------------------------------------- */
export function charac(skills){ return Math.floor((bestSkill(skills) - 1) / 3); }
export function hpMax(skills){ return (charac(skills) + 10) * 10; }
/* Regeneration, egs_variables.cpp:299-301 and character.cpp:2342-2365:
   sitting = charac/RegenDivisor(16) + RegenOffset(1.6) per second, in action
   it is the sitting rate divided by RegenReposFactor(2) plus the offset. A
   shooter regenerating under fire is wrong, so the action rate only starts
   after six seconds without being hit (our addition). */
export function regen(skills){
  const c = charac(skills) + 10;
  return { sit: c / 16 + 1.6, action: (c / 16) / 2 + 1.6, delay: 6 };
}

/* how much a weapon skill improves its weapon (our numbers) */
export function weaponMods(lv){
  return { damage: 1 + 0.01 * (lv - 1), spread: 1 - 0.006 * (lv - 1), reload: 1 - 0.005 * (lv - 1) };
}

/* --------------------------------------------------------------------------
   XP from a kill — progression/progression_pve.cpp.
   deltaLevel = skillRef - creatureLevel (line ~341), clamped to ±50
   (game_share/constants.h), magnified for low skills by
   50 / min(50, skill + 10) (~556-561), then looked up in the fight success
   table. That table is a sheet that is not in the repository; the curve
   below is ours: full XP at even level, more for harder targets, nothing for
   anything fifteen levels under you.
   ------------------------------------------------------------------------- */
const XP_CURVE = [[-20, 1.8], [-10, 1.5], [-5, 1.25], [0, 1.0], [5, 0.5], [10, 0.15], [15, 0]];
export function xpFactor(skillRef, npcLevel){
  let d = skillRef - npcLevel;
  d *= 50 / Math.min(50, skillRef + 10);
  d = Math.max(-50, Math.min(50, d));
  if (d <= XP_CURVE[0][0]) return XP_CURVE[0][1];
  for (let i = 1; i < XP_CURVE.length; i++){
    const [x1, y1] = XP_CURVE[i], [x0, y0] = XP_CURVE[i - 1];
    if (d <= x1) return y0 + (y1 - y0) * (d - x0) / (x1 - x0);
  }
  return 0;
}
export const KILL_XP_BASE = 24;                 // XP for an even-level kill, before the factor
export const MAX_XP_PER_KILL = 400;             // MaxXPGainPerPlayer (egs_variables.cpp:46), rescaled
/* team XP, progression_pve.cpp:360-371 and egs_variables.cpp:44-45:
   only the team that did the most damage is paid; divisor is
   1 + (members-1) * 0.9; members further than 50 m count in the divisor but
   get nothing */
export const XP_TEAM_DIVISOR = 0.9;
export const MAX_DIST_XP = 50;
export const TEAM_MAX = 9;                      // game_share/misc_const.h:29

/* --------------------------------------------------------------------------
   Death penalty — death_penalties.cpp. No penalty while the best skill is
   under DeathPenaltyMinLevel (10). Each death adds an XP debt, capped; part
   of all XP earned goes to the debt first; the debt also melts with time
   (DeathXPResorptionTime, 3 days in Ryzom — 30 minutes here).
   ------------------------------------------------------------------------- */
export const DEATH = { minLevel: 10, debtPerDeath: 0.5, debtCap: 1.5, repayShare: 0.5, resorbSeconds: 1800, respawnDelay: 6, respawnHp: 0.5 };
export function deathDebt(skills){
  const b = bestSkill(skills);
  if (b < DEATH.minLevel) return { add: 0, cap: 0 };
  const unit = xpForNext(b);
  return { add: unit * DEATH.debtPerDeath, cap: unit * DEATH.debtCap };
}

/* --------------------------------------------------------------------------
   NPCs: level per zone sets hit points, damage and XP (our numbers).
   ------------------------------------------------------------------------- */
export function npcHp(level){ return Math.round(100 * (1 + 0.08 * (level - 1))); }
export function npcDamageMul(level){ return 1 + 0.06 * (level - 1); }
export const NPC_RESPAWN = [80, 120];           // seconds, a random draw in this range
export const ZONE_RESET_AFTER_CAPTURE = 60;     // the counter-attack

/* hit validation: largest legitimate single hit per weapon before skill bonus,
   and the most hits per second a weapon can produce (rpm/60 with slack) */
export const HIT_CAP = { smg: { dmg: 60, rate: 22 }, lmg: { dmg: 100, rate: 14 }, pistol: { dmg: 90, rate: 10 },
                         sniper: { dmg: 300, rate: 2 }, nade: { dmg: 240, rate: 30 } };

/* loot (loot_item steps in Ryzom's missions); rights stay with the killer's
   team for a while, then the crate is anyone's */
export const LOOT = { chance: 0.65, rightsSeconds: 20, despawnSeconds: 120 };
export function rollLoot(level, rnd){
  const c = { money: Math.round((2 + rnd() * 4) * (1 + level * 0.3)) };
  if (rnd() < 0.30) c.ammo = 1;
  if (rnd() < 0.20) c.bandage = 1;
  if (rnd() < 0.12) c.nade = 1;
  return c;
}
export const PICKUP_RESPAWN = 75;

/* quartermaster (Ryzom: buy/sell steps and merchants) */
export const SHOP = {
  nade:    { name: 'Lựu đạn chày', price: 12, max: 6 },
  bandage: { name: 'Băng gạc',     price: 8,  max: 8 },
  ammo:    { name: 'Cơ số đạn',    price: 5,  max: null }
};
export const START = { money: 20, inv: { nade: 3, bandage: 2 } };

/* --------------------------------------------------------------------------
   Chat — game_share/chat_group.h and input_output_service.cpp:71-72.
   say reaches MaxDistSay = 1 GPM cell, shout MaxDistShout = 3 cells, cells are
   16 m (gpm_service/world_position_manager.h:177) and the test is per axis.
   ------------------------------------------------------------------------- */
export const CHAT = { cell: 16, say: 1, shout: 3, maxLen: 200, floodPerSec: 3 };
export const CHANNELS = ['say', 'shout', 'team', 'region', 'universe', 'tell'];

/* --------------------------------------------------------------------------
   Frontend prioritisation — frontend_service/vision_array.h and
   distance_prioritizer.cpp. Every tick each entity a client can see gains
   10000 / distance(mm) priority, slots go out highest first up to the
   client's budget, and a position is only resent when the entity has moved
   more than distance / ratio since the last one sent. Ryzom's ratio is 10;
   a shooter needs closer tracking at range, so 30 here.
   ------------------------------------------------------------------------- */
export const FRONTEND = { budget: 28, deltaRatio: 30, minMove: 0.03, vision: 250 };
