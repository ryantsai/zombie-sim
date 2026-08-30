/* ZS.GeneralSkills — the data-defined general skills from SANGUO-DESIGN §4.2.
 *
 * Content files are classic scripts so the complete almanac works from file://.
 * Battle code reads the numeric `battle` records; campaign and roster UI read
 * the bilingual name/description. No mutable runtime state belongs here. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const DEFS = {
    iron_wall: {
      id: "iron_wall",
      kind: "passive",
      name: { "zh-tw": "鐵壁", en: "Iron Wall" },
      description: {
        "zh-tw": "所屬部隊更能抵抗動搖與潰退。",
        en: "The commanded unit resists wavering and rout.",
      },
      battle: { routResistance: 0.14 },
    },
    valiant: {
      id: "valiant",
      kind: "passive",
      name: { "zh-tw": "驍勇", en: "Valiant" },
      description: {
        "zh-tw": "提高單挑攻擊與將領近戰威力。",
        en: "Raises duel attack and the general's melee power.",
      },
      battle: { duelAttack: 0.12, meleePower: 0.08 },
    },
    swift: {
      id: "swift",
      kind: "passive",
      name: { "zh-tw": "疾風", en: "Swift Wind" },
      description: {
        "zh-tw": "提高行軍與衝鋒速度。",
        en: "Raises march and charge speed.",
      },
      battle: { marchSpeed: 0.1, chargeSpeed: 0.12 },
    },
    discipline: {
      id: "discipline",
      kind: "passive",
      name: { "zh-tw": "治軍", en: "Discipline" },
      description: {
        "zh-tw": "部隊疲勞累積較慢，陣形更穩。",
        en: "Slows fatigue and steadies formation cohesion.",
      },
      battle: { fatigueRate: -0.16, cohesion: 0.06 },
    },
    charge: {
      id: "charge",
      kind: "active",
      name: { "zh-tw": "突擊", en: "Assault" },
      description: {
        "zh-tw": "發起猛烈衝鋒，造成傷害與士氣衝擊。",
        en: "Launches a fierce charge with damage and morale shock.",
      },
      battle: { cooldown: 28, potency: "zhi", order: "charge" },
    },
    fire: {
      id: "fire",
      kind: "active",
      name: { "zh-tw": "火計", en: "Fire Stratagem" },
      description: {
        "zh-tw": "在視線可及處引火，智力提高範圍與持續時間。",
        en: "Ignites a visible patch; intelligence scales reach and duration.",
      },
      battle: { cooldown: 38, potency: "zhi", target: "ground" },
    },
    ambush: {
      id: "ambush",
      kind: "active",
      name: { "zh-tw": "伏兵", en: "Ambush" },
      description: {
        "zh-tw": "揭露一支預備隊，從敵軍側後方出現。",
        en: "Reveals a reserve unit on an enemy flank or rear.",
      },
      battle: { cooldown: 52, potency: "zhi", target: "edge" },
    },
    inspire: {
      id: "inspire",
      kind: "active",
      name: { "zh-tw": "鼓舞", en: "Inspire" },
      description: {
        "zh-tw": "恢復範圍內友軍士氣，並幫助潰兵重整。",
        en: "Restores nearby morale and helps routed troops rally.",
      },
      battle: {
        cooldown: 24,
        potency: "zhi",
        radius: 190,
        baseHeal: 0.16,
        potencyHeal: 0.12,
      },
    },
    disorder: {
      id: "disorder",
      kind: "active",
      name: { "zh-tw": "亂陣", en: "Disorder" },
      description: {
        "zh-tw": "擾亂敵軍陣形，暫時降低凝聚力。",
        en: "Disrupts an enemy formation and temporarily lowers cohesion.",
      },
      battle: { cooldown: 34, potency: "zhi", target: "enemy_unit" },
    },
  };

  function get(id) {
    return DEFS[id] || null;
  }

  ZS.GeneralSkills = { DEFS, get };
})();
