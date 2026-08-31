/* Battlefield foundation verification.
 *
 * The map module is index-only but its script tag is integrated separately by
 * the shell work. This suite injects it when necessary so the generator,
 * navigation contracts and authored Blocks API remain independently runnable.
 *
 * Run: node test/sanguo-p4-maps.js
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
function ok(name, cond, detail) {
  if (cond) {
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (event) => errors.push(String(event.error())));
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });
  if (!(await page.evaluate(() => !!ZS.Battlefield))) {
    await page.addScriptTag({ url: base + "/js/battle/battlefield.js" });
  }

  console.log("\n[all field kinds and biomes]");
  const matrix = await page.evaluate(() => {
    function digest(map) {
      let h = 2166136261 >>> 0;
      const add = (n) => {
        h ^= n & 255;
        h = Math.imul(h, 16777619) >>> 0;
        h ^= (n >>> 8) & 255;
        h = Math.imul(h, 16777619) >>> 0;
      };
      const bytes = [map.nav.val, map.nav.wm, map.surface, map.moveCost];
      for (const a of bytes) for (let i = 0; i < a.length; i++) add(a[i]);
      const text = JSON.stringify({
        kind: map.kind,
        biome: map.biome,
        variant: map.variant,
        wall: map.wall,
        attackerSide: map.attackerSide,
        deploy: map.deploy,
        objective: map.objective,
        roads: map.roads,
        props: map.props,
        buildings: map.world.buildings.map((b) => ({
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.w),
          h: Math.round(b.h),
        })),
        blocks: map.blocks
          ? map.blocks.list.map((b) => ({
              tx: b.tx,
              ty: b.ty,
              w: b.w,
              h: b.h,
              kind: b.kind,
              hp: b.hp,
            }))
          : [],
      });
      for (let i = 0; i < text.length; i++) add(text.charCodeAt(i));
      return h >>> 0;
    }
    function make(field, seed) {
      const world = new ZS.World(1600, 1200);
      const nav = new ZS.Nav(world);
      world.nav = nav;
      const map = ZS.Battlefield.create(field, world, nav, seed);
      return { world, nav, map, digest: digest(map) };
    }

    const rows = [];
    const kinds = ["open", "town", "fort"];
    const biomes = ["plain", "hill", "river", "wood", "marsh"];
    let seed = 700;
    for (const kind of kinds) {
      for (const biome of biomes) {
        const made = make(
          {
            kind,
            biome,
            wallTier: kind === "fort" ? 2 : 0,
            attackerSide: seed & 1,
          },
          seed++,
        );
        const check = made.map.validate();
        rows.push({
          kind,
          biome,
          valid: check.ok,
          errors: check.errors,
          buildings: made.world.buildings.length,
          blocks: made.map.blocks ? made.map.blocks.list.length : 0,
          gate: !!made.map.gate,
          costRange: [Math.min(...made.map.moveCost), Math.max(...made.map.moveCost)],
          digest: made.digest,
        });
      }
    }
    const a = make({ kind: "town", biome: "wood", variant: 2 }, 991);
    const b = make({ kind: "town", biome: "wood", variant: 2 }, 991);
    const c = make({ kind: "town", biome: "wood", variant: 2 }, 992);
    return {
      rows,
      sameA: a.digest,
      sameB: b.digest,
      other: c.digest,
      townFamilies: [0, 1, 2].map((variant) => {
        const made = make({ kind: "town", biome: "plain", variant }, 1200 + variant);
        return {
          variant: made.map.variant,
          roads: made.map.roads.length,
          buildings: made.world.buildings.length,
          valid: made.map.validate().ok,
        };
      }),
    };
  });
  const invalid = matrix.rows.filter((row) => !row.valid);
  ok("all 15 kind/biome combinations validate", invalid.length === 0, invalid);
  ok(
    "every town combination contains buildings",
    matrix.rows.filter((row) => row.kind === "town" && row.buildings <= 0).length === 0,
    matrix.rows.filter((row) => row.kind === "town"),
  );
  ok(
    "every fort contains an authored ring and gate",
    matrix.rows.filter((row) => row.kind === "fort" && (!row.gate || row.blocks < 5)).length === 0,
    matrix.rows.filter((row) => row.kind === "fort"),
  );
  ok(
    "terrain produces modest nonzero traversal costs",
    matrix.rows.every((row) => row.costRange[0] >= 9 && row.costRange[1] <= 17),
    matrix.rows.map((row) => [row.kind, row.biome, row.costRange]),
  );
  eq("same field + seed has the same map/nav digest", matrix.sameA, matrix.sameB);
  ok("a different seed changes the generated map", matrix.sameA !== matrix.other, matrix);
  ok(
    "all three authored town families have roads, buildings and connectivity",
    matrix.townFamilies.every(
      (row) => row.variant >= 0 && row.roads >= 2 && row.buildings > 0 && row.valid,
    ),
    matrix.townFamilies,
  );

  console.log("\n[fort breach and roles]");
  const fort = await page.evaluate(() => {
    const world = new ZS.World(2000, 1400);
    const nav = new ZS.Nav(world);
    world.nav = nav;
    const map = ZS.Battlefield.create(
      { kind: "fort", biome: "hill", wallTier: 2, attackerSide: 1, variant: 1 },
      world,
      nav,
      4404,
    );
    const attacker = map.attackerSide;
    const defender = map.defenderSide;
    const closed = new ZS.FlowField(nav, {
      collisionMask: map.collisionMask(attacker, -1),
      moveCost: map.moveCost,
    });
    closed.build(map.objective.x, map.objective.y);
    const closedCost = closed.distAt(map.deploy[attacker].x, map.deploy[attacker].y);
    const approach = new ZS.FlowField(nav, {
      collisionMask: map.collisionMask(attacker, -1),
      moveCost: map.moveCost,
    });
    approach.build(map.objective.approach.x, map.objective.approach.y);
    const approachCost = approach.distAt(map.deploy[attacker].x, map.deploy[attacker].y);
    const defend = new ZS.FlowField(nav, {
      collisionMask: map.collisionMask(defender, -1),
      moveCost: map.moveCost,
    });
    defend.build(map.objective.x, map.objective.y);
    const defendCost = defend.distAt(map.deploy[defender].x, map.deploy[defender].y);
    const normalClosed = map.normalizeGoal(attacker, map.objective.x, map.objective.y);
    const version0 = nav.version;
    const gateHp = map.gate.hp;
    const broke = map.damageGate(gateHp + 1);
    const opened = new ZS.FlowField(nav, {
      collisionMask: map.collisionMask(attacker, -1),
      moveCost: map.moveCost,
    });
    opened.build(map.objective.x, map.objective.y);
    const openCost = opened.distAt(map.deploy[attacker].x, map.deploy[attacker].y);
    const normalOpen = map.normalizeGoal(attacker, map.objective.x, map.objective.y);
    return {
      attacker,
      defender,
      roles: map.deploy.map((d) => d.role),
      wall: map.wall,
      gateHp,
      closed: Number.isFinite(closedCost),
      approach: Number.isFinite(approachCost),
      defenderConnected: Number.isFinite(defendCost),
      normalClosedDistance: Math.hypot(
        normalClosed.x - map.objective.x,
        normalClosed.y - map.objective.y,
      ),
      broke,
      versionBumped: nav.version > version0,
      opened: Number.isFinite(openCost),
      normalOpenDistance: Math.hypot(
        normalOpen.x - map.objective.x,
        normalOpen.y - map.objective.y,
      ),
      gateRemoved: !map.blocks.list.includes(map.gate),
      validAfter: map.validate(),
    };
  });
  eq("wallTier aliases into the descriptor", fort.wall, 2);
  eq("attackerSide 1 deploys side 1 outside", fort.attacker, 1);
  ok(
    "roles follow side orientation",
    fort.roles[1] === "attacker" && fort.roles[0] === "defender",
    fort.roles,
  );
  ok("the attacker reaches the closed gate approach", fort.approach, fort);
  ok("the defender reaches the courtyard", fort.defenderConnected, fort);
  eq("the intact gate seals the objective", fort.closed, false);
  ok("goal normalization keeps a closed-gate order outside", fort.normalClosedDistance > 40, fort);
  ok("focused damage breaches and removes the gate", fort.broke && fort.gateRemoved, fort);
  ok("breaching the gate bumps nav.version", fort.versionBumped, fort);
  ok("the attacker reaches the courtyard after breach", fort.opened, fort);
  ok("goal normalization admits the objective after breach", fort.normalOpenDistance < 20, fort);
  ok("the breached fort still validates", fort.validAfter.ok, fort.validAfter);

  console.log("\n[FlowField compatibility and Blocks authoring]");
  const compatibility = await page.evaluate(() => {
    const world = new ZS.World(400, 400);
    const nav = new ZS.Nav(world);
    world.nav = nav;
    const a = new ZS.FlowField(nav);
    const b = new ZS.FlowField(nav, {});
    const costs = new Uint8Array(nav.n);
    costs.fill(10);
    const c = new ZS.FlowField(nav, { moveCost: costs });
    a.build(370, 370);
    b.build(370, 370);
    c.build(370, 370);
    const ca = a.distAt(30, 30);
    const cb = b.distAt(30, 30);
    const cc = c.distAt(30, 30);

    const doorWorld = new ZS.World(400, 400);
    const doorNav = new ZS.Nav(doorWorld);
    doorWorld.nav = doorNav;
    doorNav.markRect(180, 0, 40, 400, 0);
    doorNav.markRect(180, 180, 40, 40, 3);
    const human = new ZS.FlowField(doorNav);
    const blocked = new ZS.FlowField(doorNav, true);
    human.build(330, 200);
    blocked.build(330, 200);

    const tiles = new ZS.Tiles(world, nav);
    const blocks = new ZS.Blocks(world, nav, tiles);
    const stamped = blocks.stamp(2, 2, "wall", 5, 1, 2);
    const overlap = blocks.stamp(4, 2, "gate", 1, 2, 1);
    const plan = blocks.loadLayout([
      { tx: 2, ty: 6, kind: "wall", w: 4, h: 1 },
      { tx: 6, ty: 6, kind: "gate", w: 1, h: 2 },
    ]);
    return {
      ca,
      cb,
      cc,
      humanDoor: Number.isFinite(human.distAt(70, 200)),
      blockedDoor: Number.isFinite(blocked.distAt(70, 200)),
      stamped: stamped.ok && stamped.b.w === 5 && stamped.b.maxHp === ZS.Blocks.CAT.wall.hp * 2,
      overlapRejected: !overlap.ok,
      layout: plan.ok && plan.list.length === 2,
    };
  });
  eq("legacy FlowField keeps its exact diagonal cost", compatibility.ca, 238);
  eq("an empty options profile is identical", compatibility.cb, compatibility.ca);
  eq("a 10-cost terrain grid is identical", compatibility.cc, compatibility.ca);
  ok("the legacy human mask crosses an intact door", compatibility.humanDoor, compatibility);
  eq("the solid collision profile blocks that door", compatibility.blockedDoor, false);
  ok("Blocks.stamp authors a scaled long wall", compatibility.stamped, compatibility);
  ok("Blocks.stamp rejects overlap", compatibility.overlapRejected, compatibility);
  ok("Blocks.loadLayout commits a preflighted plan", compatibility.layout, compatibility);

  console.log("\n[console]");
  const real = errors.filter((error) => !/subset-data\.js|ERR_FILE_NOT_FOUND|404/.test(error));
  ok("no unexpected console errors", real.length === 0, real.slice(0, 4));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
