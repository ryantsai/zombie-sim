/* ZS.GeneralItems — immutable equipment definitions for the campaign RPG.

   A general stores only `itemIds`. Every modifier is read from this table and
   layered by ZS.General.derive(); equipping an item therefore never edits the
   general's four base attributes. The catalogue deliberately covers every
   weapon and mount recipe shipped by data/generals.js, plus a small book pool
   for campaign rewards. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const SLOTS = ["weapon", "mount", "book"];
  const DEFS = {};

  function add(id, slot, modifiers, appearance, value) {
    const names = {
      weapon: { "zh-tw": "武器", en: "Weapon" },
      mount: { "zh-tw": "馬", en: "Mount" },
      book: { "zh-tw": "兵法", en: "Book" },
    };
    DEFS[id] = {
      id,
      slot,
      name: names[slot],
      modifiers: modifiers.map((m) => ({ stat: m[0], type: m[1], value: m[2] })),
      appearance: appearance || null,
      value: value | 0,
    };
  }

  function weapon(name, wu, zhi, value) {
    const mods = [["wu", "flat", wu]];
    if (zhi) mods.push(["zhi", "flat", zhi]);
    add("weapon:" + name, "weapon", mods, { weapon: name }, value || 60 + wu * 20);
  }

  function mount(name, speed, tong, value) {
    const mods = [["cavSpeed", "flat", speed]];
    if (tong) mods.push(["tong", "flat", tong]);
    add("mount:" + name, "mount", mods, { mount: name }, value || 80 + Math.round(speed * 500));
  }

  /* Common arms. */
  for (const name of ["sword", "spear", "bow", "glaive", "halberd"]) weapon(name, 2, 0, 90);
  for (const name of [
    "dual_swords",
    "great_bow",
    "great_axe",
    "great_club",
    "great_sabre",
    "iron_whip",
    "chain_blade",
    "flying_blades",
    "ribbon_blades",
    "bow_blades",
    "twin_halberds",
  ]) {
    weapon(name, 3, 0, 145);
  }
  weapon("feather_fan", 1, 4, 160);
  weapon("ritual_staff", 1, 4, 160);

  /* Named arms keep their familiar silhouette and earn a stronger but still
     reversible modifier. */
  for (const name of [
    "ancient_sword",
    "dragon_spear",
    "heaven_sword",
    "overlord_spear",
    "serpent_spear",
  ]) {
    weapon(name, 5, 0, 320);
  }
  weapon("green_dragon", 7, 0, 520);
  weapon("sky_halberd", 8, 0, 560);

  for (const name of ["bay", "black", "chestnut", "gray", "white"]) {
    mount(name, 0.05, 0, 110);
  }
  mount("hex_mark", 0.1, 2, 300);
  mount("shadow_runner", 0.12, 2, 360);
  mount("red_hare", 0.18, 3, 600);

  add(
    "book:art_of_war",
    "book",
    [
      ["zhi", "flat", 5],
      ["zheng", "flat", 2],
    ],
    null,
    360,
  );
  add("book:wei_liaozi", "book", [["tong", "flat", 4]], null, 300);
  add(
    "book:governance",
    "book",
    [
      ["zheng", "flat", 5],
      ["zhi", "flat", 2],
    ],
    null,
    320,
  );

  function get(id) {
    return DEFS[id] || null;
  }

  function forSlot(slot) {
    const out = [];
    for (const id in DEFS) if (DEFS[id].slot === slot) out.push(DEFS[id]);
    return out;
  }

  ZS.GeneralItems = { SLOTS, DEFS, get, forSlot };
})();
