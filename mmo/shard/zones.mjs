// The five battlefields as persistent shard zones (Ryzom's continents/regions).
//
// The client builds the geometry; the shard only needs what it arbitrates:
// how many soldiers hold the zone and at what level, where people respawn,
// where the objective and the supply drops are, and the missions on offer.
// NPC indices, pickup indices and positions must match dienbienphu/index.html
// (LEVELS[n].routes, .pickups, .objective, .spawn); the shard tests pin the
// counts and tools/mmo-smoke.mjs plays against the real client.
export const ZONES = [
  {
    key: 'himlam', name: 'Đồi Him Lam', npcs: 10, level: [1, 4],
    spawn: { x: 0.4, z: 27.2 },
    objective: { x: -2.0, z: -8.45, type: 'flag' },
    pickups: [['ammo',1.6,19.4],['med',-17.2,19.6],['ammo',17.6,16.4],['med',5.6,0.4],['ammo',-9.4,-3.4],['nade',-1.6,12.4]],
    sites: { k3: { x: -16, z: 2, r: 5, name: 'mỏm đồi số 3' }, k2: { x: 14, z: -2, r: 5, name: 'mỏm đồi số 2' } }
  },
  {
    key: 'doclap', name: 'Đồi Độc Lập', npcs: 12, level: [4, 8],
    spawn: { x: 27.4, z: 4.6 },
    objective: { x: -3.6, z: -9.4, type: 'flag' },
    pickups: [['ammo',18.6,4.2],['med',14.6,6.0],['ammo',8.6,22.2],['med',2.6,-11.4],['ammo',-10.6,-4.6],['nade',13.8,-18.2]],
    sites: { mortar: { x: -3, z: -17.3, r: 5, name: 'trận địa cối 120 ly' }, north: { x: 2, z: -25, r: 6, name: 'sườn bắc' } }
  },
  {
    key: 'sanbay', name: 'Sân bay Mường Thanh', npcs: 12, level: [8, 13],
    spawn: { x: -25.6, z: 24.6 },
    objective: { x: 17.6, z: 9.8, type: 'charge' },
    pickups: [['ammo',-20.4,19.6],['med',-10.8,10.6],['ammo',-1.2,-11.2],['med',2.6,20.6],['ammo',8.4,-15.6],['nade',-11.8,-6]],
    sites: { tower: { x: 23.6, z: -9.4, r: 5, name: 'chòi canh phía Đông' }, dakota: { x: 9.4, z: -19.2, r: 6, name: 'xác Dakota phía Bắc' } }
  },
  {
    key: 'a1', name: 'Đồi A1', npcs: 14, level: [12, 18],
    spawn: { x: -1.8, z: 27.4 },
    objective: { x: 0.4, z: -12.6, type: 'flag' },
    pickups: [['ammo',1.4,15.2],['med',-15.6,19.2],['ammo',15.4,18.4],['med',-12.4,-1.8],['ammo',11,-1.2],['nade',-0.4,9.4],['med',4,-18]],
    sites: { tank: { x: -8.6, z: -0.8, r: 5, name: 'xác xe tăng M24' }, crater: { x: 8.6, z: -8.2, r: 6, name: 'hố bộc phá' } }
  },
  {
    key: 'hamdocat', name: 'Hầm Đờ Cát', npcs: 14, level: [16, 24],
    spawn: { x: 27.0, z: 3.6 },
    objective: { x: -14.0, z: -4.0, type: 'flag' },
    pickups: [['ammo',22.6,6.2],['med',19.6,3.4],['ammo',-2.2,-12.4],['med',-6,9.4],['ammo',-24,-12.8],['nade',1.4,1.2],['med',-20.4,-6.6]],
    sites: { bridge: { x: 1.6, z: 0, r: 4, name: 'đầu cầu phía Tây' }, guns: { x: -22, z: -18, r: 5, name: 'trận địa pháo 105 ly' } }
  }
];

/* -------------------------------------------------------------------------
   Missions. Steps follow the shape of Ryzom's mission steps (kill, visit,
   loot, ...) at a much smaller scale; each mission belongs to a zone and is
   given by the company commander at that zone's assembly point. `repeat` is
   the cooldown in seconds before it can be taken again.
   ------------------------------------------------------------------------- */
export const MISSIONS = [
  { id: 'hl_kill', zone: 0, title: 'Diệt hỏa điểm Him Lam', desc: 'Tiêu diệt 8 lính Lê dương trên cụm cứ điểm.',
    steps: [{ type: 'kill', n: 8 }], reward: { xp: 160, money: 25 }, repeat: 300 },
  { id: 'hl_recon', zone: 0, title: 'Trinh sát mỏm đồi số 3', desc: 'Tiếp cận mỏm đồi số 3 rồi tới mỏm đồi số 2.',
    steps: [{ type: 'visit', site: 'k3' }, { type: 'visit', site: 'k2' }], reward: { xp: 90, money: 10 }, repeat: 300 },
  { id: 'hl_loot', zone: 0, title: 'Thu chiến lợi phẩm', desc: 'Nhặt 3 hòm hàng từ quân địch bị diệt.',
    steps: [{ type: 'loot', n: 3 }], reward: { xp: 80, money: 15, items: { bandage: 1 } }, repeat: 300 },
  { id: 'hl_flag', zone: 0, title: 'Cờ trên đỉnh Him Lam', desc: 'Cắm cờ «Quyết chiến Quyết thắng» trên đỉnh đồi.',
    steps: [{ type: 'capture' }], reward: { xp: 300, money: 40, items: { nade: 1 } }, repeat: 600 },

  { id: 'dl_kill', zone: 1, title: 'Vượt hai tuyến hào', desc: 'Tiêu diệt 10 lính phòng thủ đồi Độc Lập.',
    steps: [{ type: 'kill', n: 10 }], reward: { xp: 320, money: 35 }, repeat: 300, minLevel: 3 },
  { id: 'dl_mortar', zone: 1, title: 'Câm họng cối 120 ly', desc: 'Tới trận địa cối, diệt 3 địch bằng lựu đạn.',
    steps: [{ type: 'visit', site: 'mortar' }, { type: 'kill_weapon', weapon: 'nade', n: 3 }], reward: { xp: 380, money: 40 }, repeat: 420, minLevel: 3 },
  { id: 'dl_flag', zone: 1, title: 'Cờ trên đỉnh Độc Lập', desc: 'Cắm cờ trên đỉnh đồi trước khi trời sáng.',
    steps: [{ type: 'capture' }], reward: { xp: 520, money: 60, items: { nade: 1 } }, repeat: 600, minLevel: 3 },

  { id: 'sb_kill', zone: 2, title: 'Siết vòng vây sân bay', desc: 'Tiêu diệt 12 lính quanh đường băng.',
    steps: [{ type: 'kill', n: 12 }], reward: { xp: 600, money: 55 }, repeat: 300, minLevel: 7 },
  { id: 'sb_recon', zone: 2, title: 'Trinh sát đường băng', desc: 'Tới chòi canh phía Đông rồi xác Dakota phía Bắc.',
    steps: [{ type: 'visit', site: 'tower' }, { type: 'visit', site: 'dakota' }], reward: { xp: 300, money: 25 }, repeat: 300, minLevel: 7 },
  { id: 'sb_sniper', zone: 2, title: 'Xạ thủ bắn tỉa', desc: 'Hạ 4 địch bằng phát trúng đầu.',
    steps: [{ type: 'kill_head', n: 4 }], reward: { xp: 520, money: 45 }, repeat: 420, minLevel: 7 },
  { id: 'sb_charge', zone: 2, title: 'Phá kho đạn', desc: 'Đặt bộc phá phá hủy kho đạn của địch.',
    steps: [{ type: 'capture' }], reward: { xp: 900, money: 80, items: { nade: 2 } }, repeat: 600, minLevel: 7 },

  { id: 'a1_kill', zone: 3, title: 'Giành giật đồi A1', desc: 'Tiêu diệt 14 lính trên đồi A1.',
    steps: [{ type: 'kill', n: 14 }], reward: { xp: 1100, money: 90 }, repeat: 300, minLevel: 11 },
  { id: 'a1_recon', zone: 3, title: 'Hố bộc phá', desc: 'Tới xác xe tăng M24 rồi vào hố bộc phá.',
    steps: [{ type: 'visit', site: 'tank' }, { type: 'visit', site: 'crater' }], reward: { xp: 520, money: 40 }, repeat: 300, minLevel: 11 },
  { id: 'a1_flag', zone: 3, title: 'Cờ trên đỉnh A1', desc: 'Cắm cờ trên đỉnh đồi A1.',
    steps: [{ type: 'capture' }], reward: { xp: 1600, money: 120, items: { nade: 2 } }, repeat: 600, minLevel: 11 },

  { id: 'dc_bridge', zone: 4, title: 'Đánh chiếm đầu cầu', desc: 'Vượt cầu Mường Thanh, diệt 6 địch.',
    steps: [{ type: 'visit', site: 'bridge' }, { type: 'kill', n: 6 }], reward: { xp: 1300, money: 100 }, repeat: 300, minLevel: 15 },
  { id: 'dc_guns', zone: 4, title: 'Trận địa pháo 105 ly', desc: 'Tới trận địa pháo, diệt 8 địch bằng trung liên DP-27.',
    steps: [{ type: 'visit', site: 'guns' }, { type: 'kill_weapon', weapon: 'lmg', n: 8 }], reward: { xp: 1700, money: 130 }, repeat: 420, minLevel: 15 },
  { id: 'dc_flag', zone: 4, title: 'Lá cờ trên nóc hầm', desc: 'Cắm cờ trên nóc hầm chỉ huy của De Castries.',
    steps: [{ type: 'capture' }], reward: { xp: 2600, money: 200, items: { nade: 2, bandage: 2 } }, repeat: 600, minLevel: 15 }
];
