/* ZS.General — mutable campaign progression for the immutable 200-person
   almanac (docs/SANGUO-DESIGN.md §4.1 / §4.3).

   Each Campaign owns one plain record per catalogue id. Base attributes,
   level progress, loyalty, learned skills, loadout, injury and location are
   saved; names, portraits, models, skill definitions and item definitions are
   content. Derived stats are pure reads: base -> item flat -> item percent ->
   injury percent -> clamp. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const STAT_KEYS = ["wu", "tong", "zhi", "zheng"];
  const OUTCOMES = ["ok", "wounded", "captured", "killed"];
  const INJURIES = ["none", "wounded", "maimed"];
  const MAX_LEVEL = 99;
  const SKILL_LEVELS = [1, 3, 5, 7];

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function catalogue(id) {
    return ZS.Generals && ZS.Generals.get ? ZS.Generals.get(id) : null;
  }

  function item(id) {
    return ZS.GeneralItems && ZS.GeneralItems.get ? ZS.GeneralItems.get(id) : null;
  }

  function itemInSlot(record, slot) {
    for (const id of record.itemIds || []) {
      const def = item(id);
      if (def && def.slot === slot) return id;
    }
    return null;
  }

  function normalizeLoadout(ids) {
    const bySlot = {};
    for (const id of ids || []) {
      const def = item(id);
      if (def) bySlot[def.slot] = def.id;
    }
    const out = [];
    for (const slot of (ZS.GeneralItems && ZS.GeneralItems.SLOTS) || []) {
      if (bySlot[slot]) out.push(bySlot[slot]);
    }
    return out;
  }

  function skillUnlockLevel(index) {
    return SKILL_LEVELS[index] || 1 + index * 2;
  }

  function potentialSkills(record) {
    const def = catalogue(record.id);
    return def && Array.isArray(def.skillIds) ? def.skillIds : [];
  }

  function ensureSkills(record) {
    if (!Array.isArray(record.skillIds)) record.skillIds = [];
    const unlocked = [];
    const plan = potentialSkills(record);
    for (let i = 0; i < plan.length; i++) {
      const id = plan[i];
      if (record.level < skillUnlockLevel(i) || record.skillIds.includes(id)) continue;
      record.skillIds.push(id);
      unlocked.push(id);
    }
    return unlocked;
  }

  function xpToNext(level) {
    const l = clamp(level | 0, 1, MAX_LEVEL);
    return 100 * l * l;
  }

  function normalizeProgress(record) {
    record.level = clamp(record.level | 0, 1, MAX_LEVEL);
    record.xp = Math.max(0, record.xp | 0);
    while (record.level < MAX_LEVEL && record.xp >= xpToNext(record.level)) {
      record.xp -= xpToNext(record.level);
      record.level++;
    }
    if (record.level >= MAX_LEVEL) record.xp = Math.min(record.xp, xpToNext(MAX_LEVEL) - 1);
    ensureSkills(record);
    return record;
  }

  function baseRecord(def, opts) {
    const o = opts || {};
    const allegiance = o.allegiance || null;
    const fromYear = Math.max(1, (def.fromYear || o.startYear || 194) | 0);
    const available = fromYear <= Math.max(1, (o.year || 194) | 0);
    const record = {
      id: def.id,
      wu: Number(def.wu) || 60,
      tong: Number(def.tong) || 60,
      zhi: Number(def.zhi) || 60,
      zheng: Number(def.zheng) || 60,
      level: Math.max(1, def.level | 0) || 1,
      xp: Math.max(0, def.xp | 0),
      loyalty: clamp(typeof def.loyalty === "number" ? def.loyalty : 75, 0, 100),
      skillIds: [],
      itemIds: normalizeLoadout(def.itemIds),
      injury: INJURIES.includes(def.injury) ? def.injury : "none",
      injuryT: Math.max(0, def.injuryT | 0),
      location: available ? o.home || (allegiance ? null : "free") : "unavailable",
      allegiance,
      capturedBy: null,
      dead: false,
      fromYear,
    };
    normalizeProgress(record);
    return record;
  }

  function hydrate(def, saved, opts) {
    const record = baseRecord(def, opts);
    if (!saved || typeof saved !== "object") return record;
    for (const key of STAT_KEYS) {
      const n = saved[key] !== undefined ? saved[key] : saved.base && saved.base[key];
      if (typeof n === "number" && isFinite(n)) record[key] = clamp(n, 1, 120);
    }
    record.level = Math.max(1, saved.level | 0) || record.level;
    record.xp = Math.max(0, saved.xp | 0);
    record.loyalty = clamp(
      typeof saved.loyalty === "number" ? saved.loyalty : record.loyalty,
      0,
      100,
    );
    record.skillIds = Array.isArray(saved.skillIds)
      ? saved.skillIds.filter((id, i, a) => !!id && a.indexOf(id) === i)
      : [];
    record.itemIds = normalizeLoadout(
      Array.isArray(saved.itemIds) ? saved.itemIds : record.itemIds,
    );
    record.injury = INJURIES.includes(saved.injury) ? saved.injury : record.injury;
    record.injuryT = Math.max(0, saved.injuryT | 0);
    record.allegiance = Object.prototype.hasOwnProperty.call(saved, "allegiance")
      ? saved.allegiance || null
      : record.allegiance;
    record.capturedBy = saved.capturedBy || null;
    record.dead = !!saved.dead;
    record.fromYear = Math.max(1, (def.fromYear || saved.fromYear || record.fromYear) | 0);
    if (typeof saved.location === "string") record.location = saved.location;
    normalizeProgress(record);
    if (record.injury === "wounded" && record.injuryT <= 0) record.injury = "none";
    if (record.dead) {
      record.location = "dead";
      record.capturedBy = null;
    } else if (record.capturedBy) {
      record.location = "captured:" + record.capturedBy;
    } else if (record.fromYear > Math.max(1, ((opts && opts.year) || 194) | 0)) {
      record.location = "unavailable";
    }
    return record;
  }

  function allegianceIndex(factions) {
    const out = {};
    for (const f of factions || []) {
      for (const id of f.roster || []) if (!out[id]) out[id] = f.id;
    }
    return out;
  }

  function savedIndex(saved) {
    const out = {};
    if (Array.isArray(saved)) {
      for (const record of saved) if (record && record.id) out[record.id] = record;
    } else if (saved && typeof saved === "object") {
      for (const id in saved) if (saved[id]) out[id] = saved[id];
    }
    return out;
  }

  function records(saved, factions, year) {
    const out = {};
    const allegiance = allegianceIndex(factions);
    const prior = savedIndex(saved);
    const all = (ZS.Generals && ZS.Generals.ALL) || [];
    for (const def of all) {
      const factionId = allegiance[def.id] || null;
      const fd = factionId ? (factions || []).find((f) => f.id === factionId) : null;
      out[def.id] = hydrate(def, prior[def.id], {
        allegiance: factionId,
        home: fd ? fd.capital : null,
        year,
        startYear: 194,
      });
    }
    return out;
  }

  function derive(record) {
    if (!record) return null;
    const values = { wu: 60, tong: 60, zhi: 60, zheng: 60, cavSpeed: 1 };
    for (const key of STAT_KEYS) {
      if (typeof record[key] === "number") values[key] = record[key];
    }
    const flat = {};
    const percent = {};
    for (const id of record.itemIds || []) {
      const def = item(id);
      for (const mod of (def && def.modifiers) || []) {
        const bucket = mod.type === "percent" ? percent : flat;
        bucket[mod.stat] = (bucket[mod.stat] || 0) + Number(mod.value || 0);
      }
    }
    const keys = STAT_KEYS.concat(["cavSpeed"]);
    for (const key of keys) {
      values[key] = (values[key] || 0) + (flat[key] || 0);
      values[key] *= 1 + (percent[key] || 0);
    }
    let injuryMul = 1;
    if (record.injury === "wounded") injuryMul = 0.85;
    else if (record.injury === "maimed") injuryMul = 0.9;
    for (const key of STAT_KEYS) values[key] = clamp(Math.round(values[key] * injuryMul), 1, 120);
    values.cavSpeed = clamp(values.cavSpeed, 0.5, 1.5);

    let duelMultiplier = 1;
    for (const id of record.skillIds || []) {
      const skill = ZS.GeneralSkills && ZS.GeneralSkills.get(id);
      duelMultiplier += (skill && skill.battle && skill.battle.duelAttack) || 0;
    }
    values.armyMoraleMax = 50 + values.tong * 0.4;
    values.armyCohesion = 0.6 + values.tong * 0.003;
    values.abilityPotency = values.zhi / 100;
    values.duelAttack = Math.round(values.wu * 2 * duelMultiplier);
    return values;
  }

  function gainXp(record, amount) {
    const gained = Math.max(0, amount | 0);
    const before = record.level;
    const oldSkills = new Set(record.skillIds || []);
    record.xp += gained;
    normalizeProgress(record);
    return {
      gained,
      levelBefore: before,
      level: record.level,
      levels: record.level - before,
      xp: record.xp,
      next: xpToNext(record.level),
      unlocked: (record.skillIds || []).filter((id) => !oldSkills.has(id)),
    };
  }

  function equip(record, itemId) {
    const def = item(itemId);
    if (!def) return { ok: false, err: "unknown_item" };
    if (!Array.isArray(record.itemIds)) record.itemIds = [];
    const previous = itemInSlot(record, def.slot);
    record.itemIds = record.itemIds.filter((id) => {
      const cur = item(id);
      return !cur || cur.slot !== def.slot;
    });
    record.itemIds.push(itemId);
    record.itemIds = normalizeLoadout(record.itemIds);
    return { ok: true, slot: def.slot, previous, itemId };
  }

  function unequip(record, slot) {
    const previous = itemInSlot(record, slot);
    if (!previous) return { ok: false, err: "empty_slot" };
    record.itemIds = record.itemIds.filter((id) => id !== previous);
    return { ok: true, slot, previous };
  }

  function adjustLoyalty(record, delta) {
    record.loyalty = clamp(record.loyalty + Number(delta || 0), 0, 100);
    return record.loyalty;
  }

  function wound(record, injury, turns) {
    const kind = INJURIES.includes(injury) ? injury : "wounded";
    record.injury = kind;
    record.injuryT = kind === "wounded" ? Math.max(1, turns | 0 || 3) : 0;
    return { injury: record.injury, injuryT: record.injuryT };
  }

  function advanceInjury(record, turns) {
    if (record.injury !== "wounded") return record.injury;
    record.injuryT = Math.max(0, record.injuryT - Math.max(0, turns | 0));
    if (record.injuryT <= 0) record.injury = "none";
    return record.injury;
  }

  function rest(record, turns) {
    const n = Math.max(1, turns | 0 || 1);
    advanceInjury(record, n * 2);
    adjustLoyalty(record, n * 8);
    return { injury: record.injury, injuryT: record.injuryT, loyalty: record.loyalty };
  }

  function canDefect(record, threshold) {
    return !record.dead && !record.capturedBy && record.loyalty <= (threshold ?? 25);
  }

  function hashUnit(seed, id, salt) {
    let h = (seed | 0) ^ 0x811c9dc5;
    const text = String(id) + ":" + salt;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  function resolveOutcome(record, report, opts) {
    const entry = report || {};
    const o = opts || {};
    if (OUTCOMES.includes(entry.outcome)) {
      return { outcome: entry.outcome, final: true, reason: "reported", roll: null };
    }
    const state = String(entry.battleState || entry.outcome || "standing").toLowerCase();
    if (entry.caught || state === "caught" || state === "captured") {
      return { outcome: "captured", final: false, reason: "caught", roll: null };
    }
    const stats = derive(record);
    const enemyZhi = Number(o.enemyZhi) || 60;
    if (entry.dead || state === "dead" || state === "fallen") {
      const chance = clamp(0.45 + (stats.zhi - enemyZhi) * 0.006, 0.08, 0.85);
      const roll = hashUnit(o.seed, record.id, "death");
      return {
        outcome: roll < chance ? "wounded" : "killed",
        final: false,
        reason: "death_save",
        chance,
        roll,
      };
    }
    if (state === "routed" || state === "routing" || state === "hunt") {
      const chance = clamp(0.35 + (enemyZhi - stats.zhi) * 0.004, 0.12, 0.72);
      const roll = hashUnit(o.seed, record.id, "capture");
      return {
        outcome: roll < chance ? "captured" : "ok",
        final: false,
        reason: "rout_sweep",
        chance,
        roll,
      };
    }
    return { outcome: "ok", final: false, reason: "standing", roll: null };
  }

  function duelAttack(record, random) {
    const base = derive(record).duelAttack;
    let roll = 0.5;
    if (typeof random === "function") roll = random();
    else if (typeof random === "number") roll = hashUnit(random, record.id, "duel");
    return Math.round(base * (0.9 + clamp(roll, 0, 0.999999) * 0.2));
  }

  function snapshot(record) {
    if (!record) return null;
    const def = catalogue(record.id) || {};
    const stats = derive(record);
    const weaponId = itemInSlot(record, "weapon");
    const mountId = itemInSlot(record, "mount");
    const bookId = itemInSlot(record, "book");
    const weapon = item(weaponId);
    const mount = item(mountId);
    const model = Object.assign({}, def.model || null);
    if (weapon && weapon.appearance && weapon.appearance.weapon) {
      model.weapon = weapon.appearance.weapon;
    }
    if (mount && mount.appearance && mount.appearance.mount) model.mount = mount.appearance.mount;
    return {
      id: record.id,
      name: def.name || record.id,
      style: def.style || null,
      faction: def.faction || null,
      factionId: def.factionId,
      allegiance: record.allegiance,
      role: def.role || null,
      wu: stats.wu,
      tong: stats.tong,
      zhi: stats.zhi,
      zheng: stats.zheng,
      level: record.level,
      xp: record.xp,
      loyalty: record.loyalty,
      skillIds: record.skillIds.slice(),
      skills: record.skillIds.map((id) => {
        const sourceSkill = (def.skills || []).find((s) => s.id === id);
        return { id, rank: sourceSkill ? sourceSkill.rank : 1 };
      }),
      itemIds: record.itemIds.slice(),
      weaponId,
      mountId,
      bookId,
      injury: record.injury,
      injuryT: record.injuryT,
      location: record.location,
      capturedBy: record.capturedBy,
      dead: record.dead,
      rarity: def.rarity || "common",
      portrait: def.portrait || null,
      model,
      unitType: def.model && def.model.mounted ? "cav" : "dao",
      armyMoraleMax: stats.armyMoraleMax,
      armyCohesion: stats.armyCohesion,
      abilityPotency: stats.abilityPotency,
      cavSpeed: stats.cavSpeed,
      duelAttack: stats.duelAttack,
    };
  }

  function releaseEligible(camp, year) {
    const released = [];
    for (const id in camp.generals || {}) {
      const record = camp.generals[id];
      if (record.dead || record.capturedBy || record.location !== "unavailable") continue;
      if (record.fromYear > year) continue;
      const faction = record.allegiance && camp.faction(record.allegiance);
      if (faction && faction.alive) {
        if (!faction.generals.includes(id)) faction.generals.push(id);
        record.location =
          (typeof camp.factionHome === "function" && camp.factionHome(record.allegiance)) || "free";
      } else {
        record.allegiance = null;
        record.location = "free";
      }
      released.push(id);
    }
    return released;
  }

  ZS.General = {
    STAT_KEYS,
    OUTCOMES,
    INJURIES,
    MAX_LEVEL,
    skillUnlockLevel,
    xpToNext,
    records,
    hydrate,
    derive,
    snapshot,
    gainXp,
    equip,
    unequip,
    adjustLoyalty,
    wound,
    advanceInjury,
    rest,
    canDefect,
    resolveOutcome,
    duelAttack,
    releaseEligible,
  };
})();
