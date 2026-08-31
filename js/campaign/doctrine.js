/* ZS.CampaignDoctrine — deterministic faction identities for campaign AI.

   A doctrine is public content, not hidden state and not a bonus. It changes
   how a faction values the same legal orders the player can issue: how much
   gold it keeps, how large a field army it masses, when it risks an attack,
   which development track comes first, and what visible terrain makes an
   enemy province attractive.

   Load after data/factions.js and before campaign/ai.js. Unknown faction ids
   receive a stable hash-selected doctrine so mods remain deterministic. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  function t(zh, en) {
    return Object.freeze({ "zh-tw": zh, en });
  }

  function doctrine(id, zh, en, summaryZh, summaryEn, knobs) {
    return Object.freeze({
      id,
      name: t(zh, en),
      summary: t(summaryZh, summaryEn),
      reserveGold: knobs.reserveGold,
      massTarget: knobs.massTarget,
      nerve: knobs.nerve,
      development: Object.freeze(knobs.development.slice()),
      target: Object.freeze({
        size: knobs.target.size,
        defence: knobs.target.defence,
        route: knobs.target.route,
        wall: knobs.target.wall,
        port: knobs.target.port,
        biome: Object.freeze(Object.assign({}, knobs.target.biome)),
      }),
    });
  }

  const LIST = Object.freeze([
    doctrine(
      "centralizer",
      "經略中原",
      "Central Command",
      "先富國整軍，再奪大郡。",
      "Builds revenue and organized armies, then contests major commanderies.",
      {
        reserveGold: 160,
        massTarget: 4200,
        nerve: 1.12,
        development: ["income", "recruit", "wall", "food"],
        target: {
          size: 125,
          defence: 0.045,
          route: 25,
          wall: -8,
          port: 10,
          biome: { plain: 30, river: 15 },
        },
      },
    ),
    doctrine(
      "grand_host",
      "世族大軍",
      "Grand Host",
      "蓄財聚眾，以大軍爭名城。",
      "Holds a deeper purse and gathers a great host for prestigious cities.",
      {
        reserveGold: 260,
        massTarget: 5200,
        nerve: 1.25,
        development: ["recruit", "income", "wall", "food"],
        target: {
          size: 145,
          defence: 0.045,
          route: 26,
          wall: -5,
          port: 0,
          biome: { plain: 35 },
        },
      },
    ),
    doctrine(
      "shock",
      "銳兵先登",
      "Shock Advance",
      "少留府庫，乘虛疾攻。",
      "Keeps little in reserve and strikes weak open ground before it can harden.",
      {
        reserveGold: 80,
        massTarget: 1700,
        nerve: 1,
        development: ["recruit", "income", "food", "wall"],
        target: {
          size: 82,
          defence: 0.078,
          route: 18,
          wall: -45,
          port: 0,
          biome: { plain: 40, river: 5 },
        },
      },
    ),
    doctrine(
      "river_lords",
      "江河水陸",
      "River Lords",
      "沿江據港，連成水陸走廊。",
      "Links rivers and ports into a corridor for rapid expansion.",
      {
        reserveGold: 120,
        massTarget: 3600,
        nerve: 1.08,
        development: ["income", "recruit", "food", "wall"],
        target: {
          size: 105,
          defence: 0.052,
          route: 23,
          wall: -15,
          port: 85,
          biome: { river: 80, marsh: 50, plain: 5 },
        },
      },
    ),
    doctrine(
      "fortress",
      "據險守土",
      "Fortress Realm",
      "厚築城防，待兵足而後出。",
      "Fortifies difficult country and attacks only behind a decisive margin.",
      {
        reserveGold: 360,
        massTarget: 3000,
        nerve: 1.65,
        development: ["wall", "food", "recruit", "income"],
        target: {
          size: 92,
          defence: 0.065,
          route: 38,
          wall: 18,
          port: 0,
          biome: { hill: 85, wood: 55, plain: -25 },
        },
      },
    ),
    doctrine(
      "steward",
      "富民蓄力",
      "Patient Steward",
      "先安百姓與府庫，再擇機擴張。",
      "Prioritizes revenue and food, preserving strength for worthwhile gains.",
      {
        reserveGold: 320,
        massTarget: 4200,
        nerve: 1.42,
        development: ["income", "food", "wall", "recruit"],
        target: {
          size: 135,
          defence: 0.06,
          route: 34,
          wall: -25,
          port: 25,
          biome: { river: 20, plain: 10 },
        },
      },
    ),
    doctrine(
      "frontier_cavalry",
      "邊騎縱橫",
      "Frontier Cavalry",
      "小軍快聚，循平野山道遠襲。",
      "Forms lean columns and accepts long marches across plains and hills.",
      {
        reserveGold: 90,
        massTarget: 3400,
        nerve: 1.08,
        development: ["recruit", "food", "income", "wall"],
        target: {
          size: 88,
          defence: 0.056,
          route: 15,
          wall: -32,
          port: -10,
          biome: { hill: 70, plain: 42, marsh: -35 },
        },
      },
    ),
  ]);

  const BY_ID = {};
  for (const item of LIST) BY_ID[item.id] = item;
  Object.freeze(BY_ID);

  /* Explicit assignments are content and therefore stable across save/load.
     The fallback below exists only for a modded faction absent from this list. */
  const FACTION = Object.freeze({
    cao_cao: "centralizer",
    yuan_shao: "grand_host",
    yuan_shu: "grand_host",
    lv_bu: "shock",
    liu_biao: "fortress",
    liu_bei: "steward",
    tao_qian: "steward",
    sun_ce: "river_lords",
    liu_zhang: "fortress",
    zhang_lu: "fortress",
    ma_teng: "frontier_cavalry",
    han_sui: "frontier_cavalry",
    gongsun_zan: "frontier_cavalry",
    gongsun_du: "fortress",
    kong_rong: "steward",
    zhang_yang: "steward",
    zhang_yan: "frontier_cavalry",
    han_court: "fortress",
    liu_yao: "river_lords",
    wang_lang: "river_lords",
    yan_baihu: "shock",
    shi_xie: "steward",
  });

  function hash(text) {
    let h = 2166136261;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function byId(id) {
    return BY_ID[id] || null;
  }

  function forFaction(factionId) {
    const id = FACTION[factionId];
    if (id) return BY_ID[id];
    return LIST[hash(factionId) % LIST.length];
  }

  ZS.CampaignDoctrine = Object.freeze({
    list: LIST,
    factionMap: FACTION,
    byId,
    forFaction,
  });
})();
