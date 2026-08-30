#!/usr/bin/env node
/* Static gate for the data-defined 200-general almanac. */
"use strict";

global.window = {};
require("../js/campaign/data/skills.js");
require("../js/campaign/data/generals.js");

const ZS = window.ZS;
const all = ZS.Generals.ALL;
const ids = new Set();
const names = new Set();
const errors = [];

function fail(g, message) {
  errors.push((g ? g.id : "catalogue") + ": " + message);
}

if (all.length !== 200) fail(null, "expected exactly 200 generals, got " + all.length);
for (const g of all) {
  if (ids.has(g.id)) fail(g, "duplicate id");
  ids.add(g.id);
  const nameKey = g.name["zh-tw"] + "|" + g.name.en;
  if (names.has(nameKey)) fail(g, "duplicate bilingual name");
  names.add(nameKey);

  for (const key of ["wu", "tong", "zhi", "zheng"]) {
    if (!Number.isInteger(g[key]) || g[key] < 1 || g[key] > 100) fail(g, key + " must be 1..100");
  }
  if (!g.skillIds.length) fail(g, "has no skills");
  let active = 0;
  let passive = 0;
  for (const id of g.skillIds) {
    const skill = ZS.GeneralSkills.get(id);
    if (!skill) fail(g, "unknown skill " + id);
    else if (skill.kind === "active") active++;
    else passive++;
  }
  if (!active || !passive) fail(g, "must have both an active and a passive skill");
  if (g.rarity === "legendary" && (active < 3 || passive < 1)) {
    fail(g, "legendary kit must have three active skills and a passive");
  }
  if (!g.portrait || !g.portrait.cap || !g.portrait.cue) fail(g, "missing portrait recipe");
  if (!g.model || !g.model.mounted) fail(g, "battle model must be mounted");
  if (!g.model || g.model.scale !== 1.5) fail(g, "battle model scale must be 1.5");
  if (!g.model.weapon || !g.model.mount) fail(g, "incomplete battle silhouette recipe");
}

if (Object.keys(ZS.Generals.CATALOGUE).length !== all.length) {
  fail(null, "catalogue index and ordered roster disagree");
}
for (const id of Object.keys(ZS.Generals.ICONIC)) {
  if (!ZS.Generals.get(id)) fail(null, "iconic appearance has no roster entry: " + id);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "generals: " +
      all.length +
      " valid, " +
      Object.keys(ZS.Generals.ICONIC).length +
      " iconic appearances, 9 skills",
  );
}
