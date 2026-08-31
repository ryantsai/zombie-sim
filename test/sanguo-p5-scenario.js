/* ScenarioSanguo P5 character integration verification.
 *
 * Runs the real scenario, maps, ability and duel modules together on open,
 * town and fort fields. The smaller unit counts keep this a focused contract
 * check rather than another full battle-duration probe.
 *
 * Run: node test/sanguo-p5-scenario.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (event) => errors.push(String(event.error())));

  try {
    await page.goto(base + "/index.html");
    await page.waitForFunction(
      () =>
        window.ZS &&
        ZS.App &&
        ZS.App.booted === true &&
        ZS.Battlefield &&
        ZS.BattleDuels &&
        ZS.BattleAbilities &&
        ZS.Handoff &&
        ZS.ScenarioSanguo,
      null,
      { timeout: 15000 },
    );

    const audit = await page.evaluate(() => {
      const ACTIVES = ["charge", "fire", "ambush", "inspire", "disorder"];
      const cases = [
        { label: "open", kind: "open", biome: "plain", variant: 0, seed: 9511 },
        { label: "town", kind: "town", biome: "wood", variant: 1, seed: 9522 },
        { label: "fort", kind: "fort", biome: "hill", variant: 2, seed: 9533 },
      ];

      function setupFor(row, seed) {
        const comp = { spear: 0.35, dao: 0.3, crossbow: 0.15, cav: 0.2 };
        return {
          seed,
          duels: true,
          attackerSide: 0,
          defenderSide: 1,
          field: {
            kind: row.kind,
            biome: row.biome,
            terrain: row.biome,
            variant: row.variant,
            wallTier: row.kind === "fort" ? 2 : 0,
            attackerSide: 0,
            defenderSide: 1,
          },
          sides: [
            {
              factionId: row.label + "_left",
              colorSlot: 0,
              comp: { ...comp },
              onField: 96,
              reserve: 70,
              generals: [
                {
                  id: row.label + "_hero",
                  name: row.label + " hero",
                  unitType: "dao",
                  wu: 98,
                  tong: 88,
                  zhi: 90,
                  skillIds: ACTIVES.slice(),
                  itemIds: ["weapon:green_dragon"],
                  duelAttack: 260,
                  duelWilling: true,
                },
              ],
            },
            {
              factionId: row.label + "_right",
              colorSlot: 1,
              comp: { ...comp },
              onField: 96,
              reserve: 30,
              generals: [
                {
                  id: row.label + "_rival",
                  name: row.label + " rival",
                  unitType: "dao",
                  wu: 72,
                  tong: 76,
                  zhi: 68,
                  skillIds: ["valiant"],
                  duelAttack: 130,
                  duelWilling: true,
                },
              ],
            },
          ],
          objective: row.kind === "fort" ? "breach" : "rout",
        };
      }

      function make(row, seed) {
        const setup = setupFor(row, seed);
        const world = new ZS.World(3200, 2400);
        world.seed = seed;
        const nav = new ZS.Nav(world);
        world.nav = nav;
        const scenario = new ZS.ScenarioSanguo(setup);
        scenario.fx = [];
        scenario.terrain(world, nav);
        const agents = [];
        scenario.init(agents, world, 1280, 800, 1);
        return { setup, world, nav, scenario, agents };
      }

      function activePatch(scenario) {
        for (let i = 0; i < scenario.firePatches.length; i++) {
          if (scenario.firePatches[i].active) return scenario.firePatches[i];
        }
        return null;
      }

      function blockedRay(scenario, general) {
        const nav = scenario._nav;
        const mask = scenario.map.collisionMask(general.side, general.type);
        const distances = [100, 180, 280, 420];
        for (let y = 60; y < scenario.h - 60; y += 70) {
          for (let x = 60; x < scenario.w - 60; x += 70) {
            if (!nav.isWalkable(x, y, mask)) continue;
            for (let d = 0; d < distances.length; d++) {
              for (let k = 0; k < 16; k++) {
                const an = (k / 16) * Math.PI * 2;
                const tx = x + Math.cos(an) * distances[d];
                const ty = y + Math.sin(an) * distances[d];
                if (tx < 0 || ty < 0 || tx > scenario.w || ty > scenario.h) continue;
                if (!nav.los(x, y, tx, ty, mask, true)) return { x, y, tx, ty };
              }
            }
          }
        }
        return null;
      }

      function sketchPixels(scenario, patch) {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 320;
        const context = canvas.getContext("2d");
        context.translate(160 - patch.x, 160 - patch.y);
        ZS.setBoil(0);
        scenario._drawFireGround(context, 1.25);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let pixels = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) pixels++;
        return pixels;
      }

      function deterministicAbilityDigest(row, seed) {
        const made = make(row, seed);
        const scenario = made.scenario;
        const general = scenario.generals.find((g) => g.side === 0);
        const point = { x: general.x, y: general.y };
        const fire = scenario.useAbility("fire", general, point);
        general.abilityCd = 0;
        const exit = scenario.map.deploy[0].exit;
        const before = made.agents.length;
        const ambush = scenario.useAbility("ambush", general, { x: exit.x, y: exit.y });
        const patch = activePatch(scenario);
        return JSON.stringify({
          fire,
          ambush,
          patch: patch && {
            x: Math.round(patch.x * 100) / 100,
            y: Math.round(patch.y * 100) / 100,
            r: Math.round(patch.r * 100) / 100,
            life: Math.round(patch.life * 100) / 100,
            seed: patch.seed,
          },
          reserve: scenario.reserves[0].left,
          additions: made.agents
            .slice(before)
            .map((a) => [Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100, a.type]),
        });
      }

      function exercise(row) {
        const made = make(row, row.seed);
        const scenario = made.scenario;
        const general = scenario.generals.find((g) => g.side === 0);
        const rival = scenario.generals.find((g) => g.side === 1);
        const ownUnit = scenario.units[general.un];
        const enemyUnit = scenario.units[rival.un];
        const point = { x: general.x, y: general.y };
        const casts = {};

        ownUnit.morale -= 20;
        casts.inspire = scenario.useAbility("inspire", general);
        const healedMorale = ownUnit.morale;
        general.abilityCd = 0;
        casts.charge = scenario.useAbility("charge", general, point);
        general.abilityCd = 0;
        casts.fire = scenario.useAbility("fire", general, point);
        const patch = activePatch(scenario);

        const reserveBefore = scenario.reserves[0].left;
        const agentsBefore = made.agents.length;
        const unitsBefore = scenario.units.length;
        const totalBefore = scenario.sides[0].total0;
        general.abilityCd = 0;
        const exit = scenario.map.deploy[0].exit;
        casts.ambush = scenario.useAbility("ambush", general, { x: exit.x, y: exit.y });
        const agentsAdded = made.agents.length - agentsBefore;
        const unitsAdded = scenario.units.length - unitsBefore;
        const reserveSpent = reserveBefore - scenario.reserves[0].left;
        const totalAdded = scenario.sides[0].total0 - totalBefore;
        let ambushBlocked = 0;
        for (let i = agentsBefore; i < made.agents.length; i++) {
          const agent = made.agents[i];
          if (
            !made.nav.isWalkable(
              agent.x,
              agent.y,
              scenario.map.collisionMask(agent.side, agent.type),
            )
          ) {
            ambushBlocked++;
          }
        }

        general.abilityCd = 0;
        enemyUnit.cx = point.x;
        enemyUnit.cy = point.y;
        const cohesionBefore = enemyUnit.cohesion;
        casts.disorder = scenario.useAbility("disorder", general, enemyUnit);
        const cohesionAfter = enemyUnit.cohesion;

        const victim = made.agents.find((a) => a.side === 1 && !a.general);
        victim.x = patch.x;
        victim.y = patch.y;
        const hpBefore = victim.hp;
        const fireGrid = new ZS.Grid(60);
        fireGrid.insert(victim);
        scenario._updateFirePatches(0.4, fireGrid);
        const hpAfter = victim.hp;

        const fireArray = scenario.firePatches;
        const fireRecord = fireArray[0];
        const fireKeys = Object.keys(fireRecord).length;
        const logBeforeTicks = scenario.orderLog.length;
        const fxBeforeTicks = scenario.fx.length;
        const emptyGrid = new ZS.Grid(60);
        for (let i = 0; i < 100; i++) scenario._updateFirePatches(0.01, emptyGrid);
        const poolStable =
          scenario.firePatches === fireArray &&
          scenario.firePatches.length === 10 &&
          scenario.firePatches[0] === fireRecord &&
          Object.keys(fireRecord).length === fireKeys &&
          scenario.orderLog.length === logBeforeTicks &&
          scenario.fx.length === fxBeforeTicks;

        const blocked = row.kind === "open" ? null : blockedRay(scenario, general);
        const oldX = general.x;
        const oldY = general.y;
        let blockedCast = null;
        let blockedError = null;
        if (blocked) {
          general.x = blocked.x;
          general.y = blocked.y;
          general.abilityCd = 0;
          blockedCast = scenario.useAbility("fire", general, {
            x: blocked.tx,
            y: blocked.ty,
          });
          blockedError = scenario.abilities.lastError;
        }
        general.x = oldX;
        general.y = oldY;

        const abilityIds = scenario.orderLog
          .filter((entry) => entry.k === "ability")
          .map((entry) => entry.id);
        const pixels = sketchPixels(scenario, patch);

        general.x = point.x;
        general.y = point.y;
        rival.x = point.x;
        rival.y = point.y;
        general.duelWilling = true;
        rival.duelWilling = true;
        general.duelCooldown = 0;
        rival.duelCooldown = 0;
        const sideBefore = scenario.sides.map((side) => ({
          alive: side.alive,
          dead: side.dead,
          routed: side.routed,
        }));
        const duelStarted = scenario.duels.tryStart(general, rival);
        const camera = scenario.camInterest(0);
        const activeRecord = scenario.duels.active;
        const cameraRecord = scenario.duels.camera;
        const roundBefore = activeRecord.round;
        scenario.frame(made.agents, 0.45, 0.45, emptyGrid);
        const frameAdvanced = activeRecord.round > roundBefore || !activeRecord.on;
        for (let i = 0; i < 20 && activeRecord.on; i++) scenario.duels.update(0.5);
        const duel = scenario.duelLog[0];
        const loser = scenario.generals.find((g) => g.generalId === duel.loser);
        const winner = scenario.generals.find((g) => g.generalId === duel.winner);
        const sideAfter = scenario.sides.map((side) => ({
          alive: side.alive,
          dead: side.dead,
          routed: side.routed,
        }));
        const cameraHeld = scenario.camInterest(0) === cameraRecord;

        scenario.over = true;
        scenario.result = winner.side;
        const context = {
          id: "p5:" + row.label,
          kind: row.kind === "open" ? "field" : "assault",
          provinceId: row.label + "_province",
          setup: scenario.setup,
          participants: {
            attacker: { factionId: scenario.setup.sides[0].factionId },
            defender: { factionId: scenario.setup.sides[1].factionId },
          },
        };
        const result = ZS.Handoff.resultFromScenario(scenario, context);
        const loserResult = result.generals.find((g) => g.id === loser.generalId);

        return {
          label: row.label,
          map: {
            kind: scenario.map.kind,
            valid: scenario.map.validate().ok,
          },
          duelAttack: general.duelAttack,
          hasDuels: !!scenario.duels,
          casts,
          healedMorale,
          moraleMax: ownUnit.moraleMax,
          abilityIds,
          fire: {
            active: !!patch,
            damage: hpBefore - hpAfter,
            poolStable,
            pixels,
          },
          ambush: {
            agentsAdded,
            unitsAdded,
            reserveSpent,
            totalAdded,
            blocked: ambushBlocked,
          },
          disorder: { cohesionBefore, cohesionAfter },
          blockedLOS: {
            found: !!blocked,
            cast: blockedCast,
            error: blockedError,
          },
          duel: {
            started: duelStarted,
            frameAdvanced,
            oneLog: scenario.duelLog.length,
            row: duel,
            loserDead: !!loser.dead,
            loserRouted: !!loser.routFlag,
            cameraRecord: camera === cameraRecord,
            cameraHeld,
            activeRecord: scenario.duels.active === activeRecord,
            sideBefore,
            sideAfter,
          },
          result: {
            duelLog: result.duelLog,
            loser: loserResult,
          },
          deterministic:
            deterministicAbilityDigest(row, row.seed + 1000) ===
            deterministicAbilityDigest(row, row.seed + 1000),
        };
      }

      return {
        defaultDuels: ZS.ScenarioSanguo.defaultSetup(20250830).duels,
        rows: cases.map(exercise),
      };
    });

    console.log("\n[scenario lifecycle]");
    eq("the unchanged P1 default setup explicitly keeps duels off", audit.defaultDuels, false);
    for (const row of audit.rows) {
      console.log("\n[" + row.label + "]");
      ok(row.label + " map validates", row.map.valid, row.map);
      eq(row.label + " map kind survives scenario terrain", row.map.kind, row.label);
      ok(row.label + " initializes the duel resolver", row.hasDuels);
      eq(row.label + " carries pre-derived duel attack from handoff", row.duelAttack, 260);
      ok(
        row.label + " casts all five actives through ScenarioSanguo",
        Object.values(row.casts).every(Boolean),
        row.casts,
      );
      eq(
        row.label + " writes each deterministic ability log",
        row.abilityIds.join(","),
        "inspire,charge,fire,ambush,disorder",
      );
      ok(
        row.label + " inspire heals without exceeding its ceiling",
        row.healedMorale > row.moraleMax - 20 && row.healedMorale <= row.moraleMax,
        row,
      );
      ok(
        row.label + " fire persists and damages a figure",
        row.fire.active && row.fire.damage > 0,
        row.fire,
      );
      ok(row.label + " fire renders through sketch primitives", row.fire.pixels > 100, row.fire);
      ok(row.label + " fire tick path keeps its fixed record pool", row.fire.poolStable, row.fire);
      ok(
        row.label + " ambush consumes reserve into exact battle ledgers",
        row.ambush.agentsAdded > 0 &&
          row.ambush.agentsAdded === row.ambush.reserveSpent &&
          row.ambush.agentsAdded === row.ambush.totalAdded &&
          row.ambush.unitsAdded > 0,
        row.ambush,
      );
      eq(row.label + " ambush figures spawn on walkable terrain", row.ambush.blocked, 0);
      ok(
        row.label + " disorder lowers the real enemy unit cohesion",
        row.disorder.cohesionAfter < row.disorder.cohesionBefore,
        row.disorder,
      );
      if (row.label !== "open") {
        ok(
          row.label + " walls/buildings reject a blocked fire cast",
          row.blockedLOS.found &&
            row.blockedLOS.cast === false &&
            row.blockedLOS.error === "no_los",
          row.blockedLOS,
        );
      }
      ok(
        row.label + " duel advances from the scenario frame hook",
        row.duel.started && row.duel.frameAdvanced,
        row.duel,
      );
      ok(
        row.label + " duel keeps stable active/camera records",
        row.duel.activeRecord && row.duel.cameraRecord && row.duel.cameraHeld,
        row.duel,
      );
      ok(
        row.label + " duel callback updates a death or rout ledger",
        row.duel.oneLog === 1 &&
          ((row.duel.row.outcome === "killed" && row.duel.loserDead) ||
            (row.duel.row.outcome === "routed" && row.duel.loserRouted)),
        row.duel,
      );
      eq(
        row.label + " handoff preserves the exact duel summary",
        JSON.stringify(row.result.duelLog),
        JSON.stringify([row.duel.row]),
      );
      ok(
        row.label + " handoff sees the duel loser state",
        row.result.loser &&
          (row.result.loser.battleState === "dead" || row.result.loser.battleState === "routed"),
        row.result.loser,
      );
      ok(row.label + " fire/ambush state replays deterministically", row.deterministic);
    }

    eq("browser console remains clean", errors.length, 0);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
