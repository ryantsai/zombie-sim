/* ScenarioSanguo + Battlefield integration verification.
 *
 * The foundation suite proves map generation in isolation. This suite crosses
 * the seam into the real scenario: terrain() creates each authored field,
 * init() deploys actual formations, Scenario goals build real FlowFields, and
 * gate/rout/reserve state passes through the battle ledgers.
 *
 * Run: node test/sanguo-p4-battle.js
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
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (event) => errors.push(String(event.error())));
  await page.goto(base + "/index.html");
  await page.waitForFunction(
    () => window.ZS && ZS.App && ZS.App.booted === true && ZS.Battlefield && ZS.ScenarioSanguo,
    null,
    { timeout: 15000 },
  );

  console.log("\n[terrain + deployment matrix]");
  const matrix = await page.evaluate(() => {
    const cases = [
      { label: "open/plain", kind: "open", biome: "plain", variant: 0, attackerSide: 0 },
      { label: "open/hill", kind: "open", biome: "hill", variant: 1, attackerSide: 1 },
      { label: "open/river", kind: "open", biome: "river", variant: 2, attackerSide: 0 },
      { label: "open/wood", kind: "open", biome: "wood", variant: 3, attackerSide: 1 },
      { label: "open/marsh", kind: "open", biome: "marsh", variant: 0, attackerSide: 0 },
      { label: "town/0", kind: "town", biome: "plain", variant: 0, attackerSide: 0 },
      { label: "town/1", kind: "town", biome: "wood", variant: 1, attackerSide: 1 },
      { label: "town/2", kind: "town", biome: "marsh", variant: 2, attackerSide: 0 },
      { label: "fort/0", kind: "fort", biome: "plain", variant: 0, attackerSide: 0 },
      { label: "fort/1", kind: "fort", biome: "hill", variant: 1, attackerSide: 1 },
      { label: "fort/2", kind: "fort", biome: "wood", variant: 2, attackerSide: 0 },
    ];
    const comp = {
      spear: 0.42,
      dao: 0.14,
      crossbow: 0.14,
      halberd: 0.1,
      cav: 0.1,
      catapult: 0.05,
      ram: 0.05,
    };

    function setupFor(row, seed, reserve0, reserve1) {
      return {
        seed,
        attackerSide: row.attackerSide,
        field: {
          kind: row.kind,
          biome: row.biome,
          terrain: row.biome,
          variant: row.variant,
          wallTier: row.kind === "fort" ? 2 : 0,
          attackerSide: row.attackerSide,
        },
        sides: [
          {
            factionId: "liu",
            colorSlot: 0,
            comp: { ...comp },
            onField: 72,
            reserve: reserve0 || 0,
            generals: [],
          },
          {
            factionId: "cao",
            colorSlot: 1,
            comp: { ...comp },
            onField: 72,
            reserve: reserve1 || 0,
            generals: [],
          },
        ],
        objective: row.kind === "fort" ? "breach" : "rout",
      };
    }

    function make(row, seed, reserve0, reserve1) {
      const setup = setupFor(row, seed, reserve0, reserve1);
      const world = new ZS.World(3200, 2400);
      world.seed = seed;
      const nav = new ZS.Nav(world);
      world.nav = nav;
      const scenario = new ZS.ScenarioSanguo(setup);
      scenario.fx = [];
      scenario.terrain(world, nav);
      const agents = [];
      scenario.init(agents, world, 1400, 900, 1);
      return { setup, world, nav, scenario, agents };
    }

    function sideMean(agents, side) {
      let x = 0;
      let y = 0;
      let n = 0;
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (a.side !== side) continue;
        x += a.x;
        y += a.y;
        n++;
      }
      return { x: x / Math.max(1, n), y: y / Math.max(1, n), n };
    }

    function firstWalkableSurface(map, type, mask) {
      for (let i = 0; i < map.surface.length; i++) {
        if (map.surface[i] !== type) continue;
        const x = (i % map.nav.w) * 20 + 10;
        const y = ((i / map.nav.w) | 0) * 20 + 10;
        if (map.nav.isWalkable(x, y, mask)) return { x, y };
      }
      return null;
    }

    function speedAt(scenario, agent, point) {
      if (!point) return null;
      const x = agent.x;
      const y = agent.y;
      const fatigue = agent.fatigue;
      agent.x = point.x;
      agent.y = point.y;
      agent.fatigue = 0;
      const speed = scenario.maxSpeed(agent);
      agent.x = x;
      agent.y = y;
      agent.fatigue = fatigue;
      return speed;
    }

    const rows = [];
    const speed = [];
    for (let index = 0; index < cases.length; index++) {
      const row = cases[index];
      const made = make(row, 8100 + index);
      const map = made.scenario.map;
      const validation = map.validate();
      let blocked = 0;
      for (let i = 0; i < made.agents.length; i++) {
        const a = made.agents[i];
        if (!made.nav.isWalkable(a.x, a.y, map.collisionMask(a.side, a.type))) blocked++;
      }

      function auditFlows() {
        const audit = { total: 0, valid: 0, failures: [] };
        for (let unitIndex = 0; unitIndex < made.scenario.units.length; unitIndex++) {
          const unit = made.scenario.units[unitIndex];
          if (!unit.alive) continue;
          const side = unit.side;
          const target =
            row.kind === "fort" && side === map.attackerSide
              ? map.objective.approach
              : map.objective;
          const accepted = made.scenario._setGoal(unit, target.x, target.y);
          const built = !!unit.ff && unit.ff.built;
          const finite = !!unit.ff && Number.isFinite(unit.ff.distAt(unit.cx, unit.cy));
          audit.total++;
          if (accepted && built && finite) audit.valid++;
          else
            audit.failures.push({
              uid: unit.uid,
              side,
              type: unit.type,
              accepted,
              built,
              finite,
              center: { x: unit.cx, y: unit.cy, cell: made.nav.cellAt(unit.cx, unit.cy) },
              target: { x: unit.tx, y: unit.ty },
            });
        }
        return audit;
      }

      const flows = auditFlows();
      const grid = new ZS.Grid(60);
      for (let i = 0; i < made.agents.length; i++) grid.insert(made.agents[i]);
      made.scenario.frame(made.agents, 0, 0, grid);
      flows.afterFrame = auditFlows();

      const means = [sideMean(made.agents, 0), sideMean(made.agents, 1)];
      const deployNear = means.map((mean, side) => {
        const d = map.deploy[side];
        return Math.hypot(mean.x - d.x, mean.y - d.y);
      });
      const fortOriented =
        row.kind !== "fort" ||
        (map.deploy[map.attackerSide].x < map.gate.x0 &&
          map.deploy[map.defenderSide].x > map.gate.x1);
      rows.push({
        label: row.label,
        kind: map.kind,
        biome: map.biome,
        variant: map.variant,
        valid: validation.ok,
        errors: validation.errors,
        agents: made.agents.length,
        total0: made.scenario.sides.map((side) => side.total0),
        blocked,
        flows,
        deployNear,
        attackerSide: made.scenario.attackerSide,
        mapAttacker: map.attackerSide,
        roles: map.deploy.map((deployment) => deployment.role),
        fortOriented,
      });

      if (row.kind === "open") {
        const unit = made.scenario.units.find(
          (candidate) => candidate.type === ZS.figure.SPEAR && candidate.mem.length > 1,
        );
        const agent =
          unit.mem.find((candidate) => candidate.type === ZS.figure.SPEAR) || unit.mem[0];
        const mask = map.collisionMask(agent.side, agent.type);
        const plain = firstWalkableSurface(map, ZS.Battlefield.SURFACE.PLAIN, mask);
        const wanted =
          row.biome === "plain"
            ? ZS.Battlefield.SURFACE.ROAD
            : row.biome === "hill"
              ? ZS.Battlefield.SURFACE.HILL
              : row.biome === "river"
                ? ZS.Battlefield.SURFACE.FORD
                : row.biome === "wood"
                  ? ZS.Battlefield.SURFACE.WOOD
                  : ZS.Battlefield.SURFACE.MARSH;
        const special = firstWalkableSurface(map, wanted, mask);
        const ordinarySpeed = speedAt(made.scenario, agent, plain);
        const terrainSpeed = speedAt(made.scenario, agent, special);
        speed.push({
          biome: row.biome,
          ordinarySpeed,
          terrainSpeed,
          ratio:
            ordinarySpeed && terrainSpeed
              ? Math.round((terrainSpeed / ordinarySpeed) * 1000) / 1000
              : null,
          hasOrdinary: !!plain,
          hasTerrain: !!special,
        });
      }
      ZS.Command.detach();
    }

    /* Repeating side-1 assault metadata must not flip when ScenarioSanguo
       consumes it. This catches a tempting but incorrect "side 0 attacks"
       assumption independently of the alternating matrix above. */
    const orientationCase = {
      kind: "fort",
      biome: "plain",
      variant: 1,
      attackerSide: 1,
    };
    const first = make(orientationCase, 99117);
    const firstOrientation = {
      attacker: first.scenario.attackerSide,
      defender: first.scenario.defenderSide,
      roles: first.scenario.map.deploy.map((deployment) => deployment.role),
      positions: first.scenario.map.deploy.map((deployment) => [
        deployment.x,
        deployment.y,
        deployment.head,
      ]),
    };
    ZS.Command.detach();
    const second = make(orientationCase, 99117);
    const secondOrientation = {
      attacker: second.scenario.attackerSide,
      defender: second.scenario.defenderSide,
      roles: second.scenario.map.deploy.map((deployment) => deployment.role),
      positions: second.scenario.map.deploy.map((deployment) => [
        deployment.x,
        deployment.y,
        deployment.head,
      ]),
    };
    ZS.Command.detach();

    return {
      rows,
      speed,
      firstOrientation,
      secondOrientation,
    };
  });

  eq("the matrix exercises 5 open + 3 town + 3 fort fields", matrix.rows.length, 11);
  ok(
    "ScenarioSanguo terrain validates every authored field",
    matrix.rows.every((row) => row.valid),
    matrix.rows.filter((row) => !row.valid),
  );
  ok(
    "init deploys the exact requested troop count on every field",
    matrix.rows.every((row) => row.agents === 144 && row.total0[0] === 72 && row.total0[1] === 72),
    matrix.rows.map((row) => ({ label: row.label, agents: row.agents, total0: row.total0 })),
  );
  ok(
    "every deployed figure starts on its Scenario collision mask",
    matrix.rows.every((row) => row.blocked === 0),
    matrix.rows.filter((row) => row.blocked),
  );
  ok(
    "every deployed block receives a valid, finite Scenario flow goal",
    matrix.rows.every(
      (row) =>
        row.flows.valid === row.flows.total &&
        row.flows.afterFrame.valid === row.flows.afterFrame.total,
    ),
    matrix.rows.filter(
      (row) =>
        row.flows.valid !== row.flows.total ||
        row.flows.afterFrame.valid !== row.flows.afterFrame.total,
    ),
  );
  ok(
    "formation centroids stay near their reserved deployment strips",
    matrix.rows.every((row) => row.deployNear.every((distance) => distance < 470)),
    matrix.rows.map((row) => ({ label: row.label, distances: row.deployNear })),
  );
  ok(
    "attacker and defender roles survive terrain/init orientation",
    matrix.rows.every(
      (row) =>
        row.attackerSide === row.mapAttacker &&
        row.roles[row.attackerSide] === "attacker" &&
        row.roles[1 - row.attackerSide] === "defender" &&
        row.fortOriented,
    ),
    matrix.rows,
  );
  eq(
    "the same side-1 assault reproduces identical orientation",
    JSON.stringify(matrix.secondOrientation),
    JSON.stringify(matrix.firstOrientation),
  );
  ok(
    "all five open biomes expose their intended speed surface",
    matrix.speed.length === 5 && matrix.speed.every((row) => row.hasOrdinary && row.hasTerrain),
    matrix.speed,
  );
  ok(
    "roads accelerate while hill, ford, wood and marsh slow Scenario movement",
    matrix.speed.every((row) =>
      row.biome === "plain" ? row.ratio > 1 : row.ratio > 0 && row.ratio < 1,
    ),
    matrix.speed,
  );

  console.log("\n[LOS + fort breach]");
  const breach = await page.evaluate(() => {
    const comp = { spear: 0.55, crossbow: 0.2, catapult: 0.15, ram: 0.1 };
    const setup = {
      seed: 44041,
      attackerSide: 1,
      field: {
        kind: "fort",
        biome: "hill",
        variant: 1,
        wallTier: 2,
        attackerSide: 1,
      },
      sides: [
        {
          factionId: "liu",
          colorSlot: 0,
          comp: { ...comp },
          onField: 64,
          reserve: 0,
          generals: [],
        },
        {
          factionId: "cao",
          colorSlot: 1,
          comp: { ...comp },
          onField: 64,
          reserve: 0,
          generals: [],
        },
      ],
      objective: "breach",
    };
    const world = new ZS.World(3200, 2400);
    world.seed = setup.seed;
    const nav = new ZS.Nav(world);
    world.nav = nav;
    const scenario = new ZS.ScenarioSanguo(setup);
    scenario.fx = [];
    scenario.terrain(world, nav);
    const agents = [];
    scenario.init(agents, world, 1400, 900, 1);
    const map = scenario.map;
    const attacker = scenario.attackerSide;
    const attackerUnit = scenario.units.find((unit) => unit.side === attacker && unit.alive);
    const defenderUnit = scenario.units.find(
      (unit) => unit.side === scenario.defenderSide && unit.alive,
    );

    function fieldTo(target) {
      const ff = new ZS.FlowField(nav, {
        collisionMask: map.collisionMask(attacker, attackerUnit.type),
        moveCost: map.moveCost,
      });
      ff.build(target.x, target.y);
      return Number.isFinite(ff.distAt(attackerUnit.cx, attackerUnit.cy));
    }

    const gate = map.gate;
    const gy = (gate.y0 + gate.by) * 0.5;
    const attackerAgent = attackerUnit.mem.find((agent) => !agent.dead);
    const defenderAgent = defenderUnit.mem.find((agent) => !agent.dead);
    const oldA = { x: attackerAgent.x, y: attackerAgent.y };
    const oldD = { x: defenderAgent.x, y: defenderAgent.y };
    attackerAgent.x = gate.x0 - 30;
    attackerAgent.y = gy;
    defenderAgent.x = gate.x1 + 30;
    defenderAgent.y = gy;
    const losClosed = scenario._hasLOS(attackerAgent, defenderAgent);
    const objectiveClosed = fieldTo(map.objective);
    const approachClosed = fieldTo(map.objective.approach);
    const version0 = nav.version;
    const broke = map.damageGate(gate.hp + 1);
    const grid = new ZS.Grid(60);
    for (let i = 0; i < agents.length; i++) grid.insert(agents[i]);
    scenario.frame(agents, 0, 1, grid);
    const losOpen = scenario._hasLOS(attackerAgent, defenderAgent);
    const objectiveOpen = fieldTo(map.objective);
    attackerAgent.x = oldA.x;
    attackerAgent.y = oldA.y;
    defenderAgent.x = oldD.x;
    defenderAgent.y = oldD.y;
    const objectiveOrders = scenario.units.filter(
      (unit) =>
        unit.side === attacker &&
        unit.orders.length &&
        Math.hypot(unit.tx - map.objective.x, unit.ty - map.objective.y) < 25,
    ).length;
    const result = {
      attacker,
      roles: map.deploy.map((deployment) => deployment.role),
      losClosed,
      losOpen,
      objectiveClosed,
      approachClosed,
      broke,
      gateBroken: gate.broken,
      gateRemoved: !map.blocks.list.includes(gate),
      versionBumped: nav.version > version0,
      scenarioBreached: scenario.gateBreached,
      objectiveOpen,
      objectiveOrders,
    };
    ZS.Command.detach();
    return result;
  });
  eq("a closed gate blocks Scenario line of sight", breach.losClosed, false);
  eq("a closed gate seals the courtyard from the attacker", breach.objectiveClosed, false);
  ok("the attacker can still flow to the gate approach", breach.approachClosed, breach);
  ok(
    "focused gate damage removes the gate and bumps navigation",
    breach.broke && breach.gateBroken && breach.gateRemoved && breach.versionBumped,
    breach,
  );
  ok("ScenarioSanguo observes and latches the breach", breach.scenarioBreached, breach);
  ok("the breached opening restores Scenario line of sight", breach.losOpen, breach);
  ok("the attacker can flow to the courtyard after breach", breach.objectiveOpen, breach);
  ok(
    "breach retargets active attacker blocks onto the objective",
    breach.objectiveOrders > 0,
    breach,
  );

  console.log("\n[reserve ledgers]");
  const reserve = await page.evaluate(() => {
    const comp = { spear: 0.5, dao: 0.2, crossbow: 0.2, cav: 0.1 };
    const setup = {
      seed: 55051,
      attackerSide: 0,
      field: { kind: "town", biome: "plain", variant: 2, attackerSide: 0 },
      sides: [
        {
          factionId: "liu",
          colorSlot: 0,
          comp: { ...comp },
          onField: 40,
          reserve: 190,
          generals: [],
        },
        {
          factionId: "cao",
          colorSlot: 1,
          comp: { ...comp },
          onField: 40,
          reserve: 75,
          generals: [],
        },
      ],
      objective: "rout",
    };
    const world = new ZS.World(3200, 2400);
    world.seed = setup.seed;
    const nav = new ZS.Nav(world);
    world.nav = nav;
    const scenario = new ZS.ScenarioSanguo(setup);
    scenario.fx = [];
    scenario.terrain(world, nav);
    const agents = [];
    scenario.init(agents, world, 1400, 900, 1);

    function snapshot(label) {
      const bySide = [0, 0];
      for (let i = 0; i < agents.length; i++) {
        if (!agents[i].dead && !agents[i].gone) bySide[agents[i].side]++;
      }
      return {
        label,
        agents: agents.length,
        bySide,
        sides: scenario.sides.map((side) => ({ ...side })),
        reserve: scenario.reserves.map((entry) => entry.left),
      };
    }

    const phases = [snapshot("initial")];
    scenario.maintain(agents, 10);
    phases.push(snapshot("first stream"));
    scenario.maintain(agents, 10);
    phases.push(snapshot("second stream"));
    const balanced = phases.every((phase) =>
      phase.sides.every(
        (side, index) =>
          side.dead + side.routed + side.alive === side.total0 &&
          phase.bySide[index] === side.alive + side.routed,
      ),
    );
    ZS.Command.detach();
    return { phases, balanced };
  });
  ok("reserve streaming never breaks the side ledgers", reserve.balanced, reserve.phases);
  ok(
    "the first stream admits 160 + 75 soldiers exactly",
    reserve.phases[1].sides[0].total0 === 200 &&
      reserve.phases[1].sides[1].total0 === 115 &&
      reserve.phases[1].reserve[0] === 30 &&
      reserve.phases[1].reserve[1] === 0,
    reserve.phases,
  );
  ok(
    "the final stream exhausts reserves without losing a soldier",
    reserve.phases[2].sides[0].total0 === 230 &&
      reserve.phases[2].sides[1].total0 === 115 &&
      reserve.phases[2].reserve[0] === 0 &&
      reserve.phases[2].reserve[1] === 0 &&
      reserve.phases[2].agents === 345,
    reserve.phases,
  );

  console.log("\n[rout exits]");
  const rout = await page.evaluate(() => {
    const comp = { spear: 1 };
    const setup = {
      seed: 66061,
      attackerSide: 0,
      field: { kind: "town", biome: "wood", variant: 0, attackerSide: 0 },
      sides: [
        {
          factionId: "liu",
          colorSlot: 0,
          comp: { ...comp },
          onField: 20,
          reserve: 0,
          generals: [],
        },
        {
          factionId: "cao",
          colorSlot: 1,
          comp: { ...comp },
          onField: 20,
          reserve: 0,
          generals: [],
        },
      ],
      objective: "rout",
    };
    const world = new ZS.World(3200, 2400);
    world.seed = setup.seed;
    const nav = new ZS.Nav(world);
    world.nav = nav;
    const scenario = new ZS.ScenarioSanguo(setup);
    scenario.fx = [];
    scenario.terrain(world, nav);
    const agents = [];
    scenario.init(agents, world, 1400, 900, 1);
    const agent = agents.find((candidate) => candidate.side === 0 && !candidate.flag);
    const exit = scenario.map.deploy[agent.side].exit;
    const grid = new ZS.Grid(60);
    for (let i = 0; i < agents.length; i++) grid.insert(agents[i]);
    const before = { ...scenario.sides[agent.side] };
    ZS.scenario = scenario;
    scenario._setRout(agent);
    const onRout = {
      free: !!agent.free,
      exitX: agent.fleeExitX,
      exitY: agent.fleeExitY,
      ledger: { ...scenario.sides[agent.side] },
    };
    scenario._flee(agent, 1 / 30, 0, grid, nav);
    const farFromExit = { free: !!agent.free, hasPath: !!agent.path };
    agent.x = exit.x;
    agent.y = exit.y;
    scenario._flee(agent, 1 / 30, 1 / 30, grid, nav);
    const atExit = { free: !!agent.free };
    if (exit.x < world.w * 0.5) agent.x = -31;
    else agent.x = world.w + 31;
    if (exit.y < 1) agent.y = -31;
    else if (exit.y > world.h - 1) agent.y = world.h + 31;
    scenario.frame(agents, 0, 1, grid);
    const afterExit = {
      gone: !!agent.gone,
      goneLedger: scenario.sides[agent.side].gone,
      ledger: { ...scenario.sides[agent.side] },
    };
    const result = { before, onRout, farFromExit, atExit, afterExit, exit };
    ZS.Command.detach();
    return result;
  });
  eq("routing on an authored map does not immediately make a unit free", rout.onRout.free, false);
  ok(
    "the router records its side's authored exit",
    rout.onRout.exitX === rout.exit.x && rout.onRout.exitY === rout.exit.y,
    rout,
  );
  eq(
    "routing toward, but still away from, the exit remains collision-bound",
    rout.farFromExit.free,
    false,
  );
  eq("the unit becomes free only when it reaches the exit", rout.atExit.free, true);
  ok(
    "crossing beyond that exit marks the unit gone",
    rout.afterExit.gone && rout.afterExit.goneLedger === 1,
    rout,
  );
  ok(
    "routing and exiting preserve dead + routed + standing = deployed",
    rout.afterExit.ledger.dead + rout.afterExit.ledger.routed + rout.afterExit.ledger.alive ===
      rout.afterExit.ledger.total0,
    rout,
  );

  console.log("\n[console]");
  const realErrors = errors.filter(
    (error) => !/subset-data\.js|ERR_FILE_NOT_FOUND|favicon\.ico|404/.test(error),
  );
  ok("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 6));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
