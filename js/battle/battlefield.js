/* ZS.Battlefield — deterministic terrain for 火柴三國 battles.
 *
 * Generation is cold-path and data-first: the seed produces a surface/cost
 * grid, authored topology, deployments and objectives; rendering only reads
 * that record. Nothing here consumes ScenarioSanguo's combat RNG, so adding a
 * tree or changing a road cannot change the next attack roll.
 *
 * `create(field, world, nav, seed)` owns the entire custom-terrain branch of
 * Engine.start. It therefore resets the world's optional furniture, marks Nav
 * itself, and leaves the finished descriptor on `world.battlefield`.
 */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const CELL = 20; // js/nav.js
  const TAU = Math.PI * 2;
  const BIOMES = ["plain", "hill", "river", "wood", "marsh"];
  const KINDS = ["open", "town", "fort"];

  const SURFACE = {
    PLAIN: 0,
    ROAD: 1,
    HILL: 2,
    WOOD: 3,
    MARSH: 4,
    FORD: 5,
  };
  /* Integer tenths consumed by FlowField: 10 is the exact legacy cost. */
  const COST = [10, 9, 13, 14, 17, 15];

  const FLOOD_DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const FLOOD_DY = [0, 0, 1, -1, 1, -1, 1, -1];

  function seeded(seed, salt) {
    return ZS.rng32(((seed | 0) ^ salt) | 0);
  }

  function normaliseField(field, seed) {
    field = field || {};
    const kind = KINDS.indexOf(field.kind) >= 0 ? field.kind : "open";
    const biome = BIOMES.indexOf(field.biome) >= 0 ? field.biome : "plain";
    const families = kind === "town" ? 3 : kind === "open" ? 4 : 3;
    const rng = seeded(seed, 0x2f6e2b1);
    const supplied = Number(field.variant);
    let attackerSide = field.attackerSide === 1 ? 1 : 0;
    if (Array.isArray(field.roles)) {
      if (field.roles[0] === "defender" || field.roles[1] === "attacker") attackerSide = 1;
    }
    const wallValue = field.wallTier !== undefined ? field.wallTier : field.wall;
    const variant = Number.isFinite(supplied)
      ? (((supplied | 0) % families) + families) % families
      : (rng() * families) | 0;
    return {
      kind,
      biome,
      variant,
      terrain: field.terrain || biome,
      provinceId: field.provinceId || null,
      wall: ZS.clamp(wallValue | 0, 0, 2),
      attackerSide,
    };
  }

  function resetWorld(world, nav, seed) {
    world.seed = seed | 0;
    world.forest = null;
    world.towns = [];
    world.trees.length = 0;
    world.buildings = [];
    world.blocks = null;
    world.ripples.length = 0;
    world.ponds = [];
    world.lake = { cx: 0, cy: 0, r: 0, pts: [] };
    world.river = {
      pts: [],
      samples: [],
      baseX: world.w * 0.5,
      baseW: 0,
      a1: 0,
      a2: 0,
      p1: 0,
      p2: 0,
      p3: 0,
      ori: "v",
    };
    nav.val.fill(1);
    nav.wm.fill(0);
    nav.version = 0;
    /* Buildings owns singleton lookup arrays. Reset them even on a field with
       no buildings so a town fought immediately before this battle cannot
       leak occupancy ids into the new world. */
    if (ZS.Buildings && ZS.Buildings.generate) ZS.Buildings.generate(world, nav);
  }

  function baseDescriptor(field, world, nav, seed) {
    const spec = normaliseField(field, seed);
    const surface = new Uint8Array(nav.n);
    const moveCost = new Uint8Array(nav.n);
    moveCost.fill(COST[SURFACE.PLAIN]);
    const y = world.h * 0.5;
    const x0 = Math.max(90, world.w * 0.16);
    const x1 = Math.min(world.w - 90, world.w * 0.84);
    const span = Math.max(160, Math.min(860, world.h * 0.54));
    const map = {
      seed: seed | 0,
      kind: spec.kind,
      biome: spec.biome,
      terrain: spec.terrain,
      variant: spec.variant,
      provinceId: spec.provinceId,
      wall: spec.wall,
      attackerSide: spec.attackerSide,
      defenderSide: 1 - spec.attackerSide,
      world,
      nav,
      surface,
      moveCost,
      deploy: [
        {
          x: x0,
          y,
          head: 0,
          span,
          role: spec.attackerSide === 0 ? "attacker" : "defender",
          exit: { x: 22, y },
        },
        {
          x: x1,
          y,
          head: Math.PI,
          span,
          role: spec.attackerSide === 1 ? "attacker" : "defender",
          exit: { x: world.w - 22, y },
        },
      ],
      objective: { kind: "rout", x: world.w * 0.5, y, r: 110 },
      props: [],
      roads: [],
      exits: [
        { x: 22, y: world.h * 0.5, side: 0 },
        { x: world.w - 22, y: world.h * 0.5, side: 1 },
        { x: world.w * 0.5, y: 22, side: -1 },
        { x: world.w * 0.5, y: world.h - 22, side: -1 },
      ],
      tiles: null,
      blocks: null,
      gate: null,
      _reach: [null, null],
      _reachVersion: [-1, -1],
    };
    attachMethods(map);
    return map;
  }

  function setSurface(map, i, type) {
    if (i < 0 || i >= map.surface.length) return;
    /* A road/ford is intentional connective tissue and wins over a later
       decorative patch. */
    if (
      (map.surface[i] === SURFACE.ROAD || map.surface[i] === SURFACE.FORD) &&
      type !== SURFACE.ROAD &&
      type !== SURFACE.FORD
    ) {
      return;
    }
    map.surface[i] = type;
    map.moveCost[i] = COST[type] || 10;
  }

  function patchPoints(cx, cy, rx, ry, rng) {
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const q = 0.9 + rng() * 0.2;
      pts.push({ x: cx + Math.cos(a) * rx * q, y: cy + Math.sin(a) * ry * q });
    }
    return pts;
  }

  function paintEllipse(map, cx, cy, rx, ry, type, seed, rng, visible = true) {
    const nav = map.nav;
    const ix0 = Math.max(0, ((cx - rx) / CELL) | 0);
    const iy0 = Math.max(0, ((cy - ry) / CELL) | 0);
    const ix1 = Math.min(nav.w - 1, ((cx + rx) / CELL) | 0);
    const iy1 = Math.min(nav.h - 1, ((cy + ry) / CELL) | 0);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix * CELL + CELL * 0.5 - cx) / rx;
        const dy = (iy * CELL + CELL * 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) setSurface(map, iy * nav.w + ix, type);
      }
    }
    if (visible) {
      map.props.push({
        kind: "patch",
        type,
        cx,
        cy,
        rx,
        ry,
        seed,
        pts: patchPoints(cx, cy, rx, ry, rng),
      });
    }
  }

  function pointSegmentDistance2(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    let q = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
    q = ZS.clamp(q, 0, 1);
    const dx = px - (ax + vx * q);
    const dy = py - (ay + vy * q);
    return dx * dx + dy * dy;
  }

  function paintRoad(map, points, width, seed, type = SURFACE.ROAD, record = true) {
    if (!points || points.length < 2) return;
    if (record) map.roads.push({ points, width, seed, type });
    const nav = map.nav;
    const rr = width * width * 0.25;
    for (let iy = 0; iy < nav.h; iy++) {
      const y = iy * CELL + CELL * 0.5;
      for (let ix = 0; ix < nav.w; ix++) {
        const x = ix * CELL + CELL * 0.5;
        for (let p = 1; p < points.length; p++) {
          const a = points[p - 1];
          const b = points[p];
          if (pointSegmentDistance2(x, y, a.x, a.y, b.x, b.y) <= rr) {
            setSurface(map, iy * nav.w + ix, type);
            break;
          }
        }
      }
    }
  }

  function markLandRect(nav, x, y, w, h) {
    const ix0 = Math.max(0, (x / CELL) | 0);
    const iy0 = Math.max(0, (y / CELL) | 0);
    const ix1 = Math.min(nav.w - 1, ((x + w) / CELL) | 0);
    const iy1 = Math.min(nav.h - 1, ((y + h) / CELL) | 0);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = ix * CELL + CELL * 0.5;
        const cy = iy * CELL + CELL * 0.5;
        if (cx < x || cx >= x + w || cy < y || cy >= y + h) continue;
        const i = iy * nav.w + ix;
        nav.val[i] = 1;
        nav.wm[i] = 0;
      }
    }
  }

  function makePond(map, cx, cy, r, rng, seed) {
    const pond = { cx, cy, r, pts: patchPoints(cx, cy, r, r * 0.72, rng) };
    map.world.ponds.push(pond);
    map.props.push({ kind: "pond", x: cx, y: cy, r, seed });
  }

  function addRiver(map, rng, seed) {
    const world = map.world;
    const nav = map.nav;
    const phase = rng() * TAU;
    const base = world.w * (0.46 + rng() * 0.08);
    const width = Math.max(58, Math.min(118, world.w * 0.04));
    const amp = Math.max(26, Math.min(105, world.w * 0.035));
    const left = [];
    const right = [];
    const samples = [];
    for (let y = -40; y <= world.h + 40; y += 80) {
      const x = base + Math.sin(y * 0.0031 + phase) * amp;
      const hw = width * (0.43 + 0.1 * Math.sin(y * 0.0047 + phase * 0.7));
      left.push({ x: x - hw, y });
      right.push({ x: x + hw, y });
      samples.push({ x, y, hw });
    }
    world.river = {
      pts: left.concat(right.reverse()),
      samples,
      baseX: base,
      baseW: width,
      a1: amp,
      a2: 0,
      p1: phase,
      p2: 0,
      p3: phase * 0.7,
      f1: 0.0031,
      f2: 0,
      ori: "v",
    };
    nav.markWater();

    const ys = [world.h * 0.29, world.h * 0.5, world.h * 0.71];
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i];
      let sample = samples[0];
      for (let k = 1; k < samples.length; k++) {
        if (Math.abs(samples[k].y - y) < Math.abs(sample.y - y)) sample = samples[k];
      }
      const bridgeW = sample.hw * 2 + 84;
      markLandRect(nav, sample.x - bridgeW * 0.5, y - 36, bridgeW, 72);
      paintRoad(
        map,
        [
          { x: sample.x - bridgeW * 0.7, y },
          { x: sample.x + bridgeW * 0.7, y },
        ],
        58,
        seed + i * 17,
        i === 1 ? SURFACE.ROAD : SURFACE.FORD,
      );
      map.props.push({ kind: "bridge", x: sample.x, y, w: bridgeW, seed: seed + 70 + i });
    }
    /* The central crossing is the fair, legible deployment axis. */
    map.deploy[0].y = ys[1];
    map.deploy[1].y = ys[1];
    map.deploy[0].exit.y = ys[1];
    map.deploy[1].exit.y = ys[1];
    map.objective.y = ys[1];
    paintRoad(
      map,
      [
        { x: map.deploy[0].x, y: ys[1] },
        { x: world.w * 0.5, y: ys[1] },
        { x: map.deploy[1].x, y: ys[1] },
      ],
      48,
      seed + 101,
    );
  }

  function addTrees(world, rng, cx, cy, rx, ry, count) {
    if (!world.placeTree) return;
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng());
      world.placeTree(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, rng);
    }
  }

  function addBiome(map, rng, seed, restrained) {
    const w = map.world.w;
    const h = map.world.h;
    const n = restrained ? 2 : 3;
    if (map.biome === "plain") {
      if (!restrained) {
        paintRoad(
          map,
          [
            { x: w * 0.12, y: h * (0.42 + rng() * 0.12) },
            { x: w * 0.5, y: h * (0.48 + rng() * 0.04) },
            { x: w * 0.88, y: h * (0.42 + rng() * 0.12) },
          ],
          42,
          seed + 1,
        );
      }
      map.props.push({ kind: "camp", x: w * 0.22, y: h * 0.19, w: 150, h: 95, faction: 0, seed });
      map.props.push({
        kind: "camp",
        x: w * 0.78,
        y: h * 0.81,
        w: 150,
        h: 95,
        faction: 1,
        seed: seed + 9,
      });
      return;
    }
    if (map.biome === "river") {
      addRiver(map, rng, seed);
      return;
    }
    for (let i = 0; i < n; i++) {
      const cx = w * (0.3 + rng() * 0.4);
      const cy = h * (0.18 + rng() * 0.64);
      const rx = Math.max(90, Math.min(300, w * (0.08 + rng() * 0.05)));
      const ry = Math.max(70, Math.min(230, h * (0.07 + rng() * 0.05)));
      if (map.biome === "hill") {
        paintEllipse(map, cx, cy, rx, ry, SURFACE.HILL, seed + i * 19, rng);
        map.props.push({
          kind: "hill",
          x: cx,
          y: cy,
          w: rx * 1.6,
          h: ry * 0.85,
          seed: seed + 200 + i,
        });
      } else if (map.biome === "wood") {
        paintEllipse(map, cx, cy, rx, ry, SURFACE.WOOD, seed + i * 19, rng);
        addTrees(map.world, rng, cx, cy, rx * 0.88, ry * 0.88, restrained ? 11 : 22);
      } else {
        paintEllipse(map, cx, cy, rx, ry, SURFACE.MARSH, seed + i * 19, rng);
        if (!restrained && i < 2)
          makePond(map, cx + rx * 0.22, cy, Math.min(rx, ry) * 0.22, rng, seed + 300 + i);
      }
    }
    if (map.biome === "marsh" && map.world.ponds.length) map.nav.markWater();
  }

  function buildOpen(map) {
    const rng = seeded(map.seed, 0x6f70656e);
    addBiome(map, rng, 1100 + map.variant * 101, false);
    if (map.biome !== "wood") {
      addTrees(map.world, rng, map.world.w * 0.16, map.world.h * 0.2, 150, 130, 8);
      addTrees(map.world, rng, map.world.w * 0.84, map.world.h * 0.8, 150, 130, 8);
    }
  }

  function townTopology(map) {
    const w = map.world.w;
    const h = map.world.h;
    const cx = w * 0.5;
    const cy = h * 0.5;
    /* Buildings inherited from The Outbreak are 180–320px wide. A district
       spread below that could place only one before overlap rejection; the
       larger ward gives each authored cluster room to read as a town. */
    const spread = Math.max(480, Math.min(620, w * 0.19));
    if (map.variant === 0) {
      return {
        towns: [
          { x: w * 0.38, y: h * 0.29, n: 5, spread },
          { x: w * 0.62, y: h * 0.29, n: 5, spread },
          { x: w * 0.38, y: h * 0.72, n: 5, spread },
          { x: w * 0.62, y: h * 0.72, n: 5, spread },
        ],
        roads: [
          [
            { x: w * 0.1, y: cy },
            { x: w * 0.9, y: cy },
          ],
          [
            { x: cx, y: h * 0.12 },
            { x: cx, y: h * 0.88 },
          ],
        ],
      };
    }
    if (map.variant === 1) {
      return {
        towns: [
          { x: w * 0.42, y: h * 0.27, n: 7, spread },
          { x: w * 0.58, y: h * 0.73, n: 7, spread },
        ],
        roads: [
          [
            { x: w * 0.1, y: cy },
            { x: w * 0.9, y: cy },
          ],
          [
            { x: w * 0.22, y: h * 0.35 },
            { x: w * 0.78, y: h * 0.35 },
          ],
          [
            { x: w * 0.22, y: h * 0.65 },
            { x: w * 0.78, y: h * 0.65 },
          ],
          [
            { x: cx, y: h * 0.35 },
            { x: cx, y: h * 0.65 },
          ],
        ],
      };
    }
    return {
      towns: [
        { x: w * 0.35, y: h * 0.3, n: 5, spread },
        { x: w * 0.52, y: h * 0.72, n: 5, spread },
        { x: w * 0.68, y: h * 0.28, n: 5, spread },
      ],
      roads: [
        [
          { x: w * 0.1, y: h * 0.42 },
          { x: w * 0.34, y: h * 0.42 },
          { x: w * 0.48, y: h * 0.56 },
          { x: w * 0.66, y: h * 0.56 },
          { x: w * 0.9, y: h * 0.48 },
        ],
        [
          { x: cx, y: h * 0.16 },
          { x: cx, y: h * 0.84 },
        ],
      ],
    };
  }

  function buildTown(map) {
    const rng = seeded(map.seed, 0x746f776e);
    /* Terrain remains subordinate to the authored street network. River maps
       still get crossings; other biomes stay in compact side patches. */
    addBiome(map, rng, 2100 + map.variant * 101, true);
    const top = townTopology(map);
    map.world.towns = top.towns;
    for (let i = 0; i < top.roads.length; i++) {
      paintRoad(map, top.roads[i], i === 0 ? 76 : 58, 2300 + map.variant * 31 + i);
    }
    ZS.Buildings.generate(map.world, map.nav);
    for (let side = 0; side < 2; side++) {
      const deploy = map.deploy[side];
      if (map.nav.isWalkable(deploy.x, deploy.y, true)) continue;
      const clear = map.nav.nearestWalkable(deploy.x, deploy.y, 420, true);
      if (clear) {
        deploy.x = clear.x;
        deploy.y = clear.y;
        deploy.exit.y = clear.y;
      }
    }
    /* Keep the objective in the nearest street/plaza cell even when an odd
       building archetype reaches farther than its district normally does. */
    const p = map.nav.nearestWalkable(map.objective.x, map.objective.y, 360, true);
    if (p) {
      map.objective.x = p.x;
      map.objective.y = p.y;
    }
    addTrees(map.world, rng, map.world.w * 0.16, map.world.h * 0.2, 120, 120, 8);
    addTrees(map.world, rng, map.world.w * 0.84, map.world.h * 0.8, 120, 120, 8);
    map.props.push({
      kind: "ruins",
      x: map.world.w * (map.variant === 2 ? 0.73 : 0.27),
      y: map.world.h * 0.5,
      r: 38,
      seed: 2500 + map.variant,
    });
  }

  function buildFort(map) {
    const world = map.world;
    const nav = map.nav;
    const rng = seeded(map.seed, 0x666f7274);
    const tiles = new ZS.Tiles(world, nav);
    const blocks = new ZS.Blocks(world, nav, tiles);
    world.blocks = blocks;
    map.tiles = tiles;
    map.blocks = blocks;

    const cols = tiles.cols;
    const rows = tiles.rows;
    const ringW = Math.max(16, Math.min(cols - 12, Math.round(cols * (0.46 + map.variant * 0.02))));
    const ringH = Math.max(14, Math.min(rows - 8, Math.round(rows * (0.58 + map.variant * 0.02))));
    const x0 = Math.max(5, ((cols - ringW) / 2) | 0);
    const y0 = Math.max(4, ((rows - ringH) / 2) | 0);
    const thick = map.wall >= 2 ? 2 : 1;
    const gateH = map.wall >= 2 ? 3 : 2;
    const gateY = ZS.clamp(
      (y0 + (ringH - gateH) / 2) | (0 + (map.variant - 1) * 2),
      y0 + thick + 2,
      y0 + ringH - thick - gateH - 2,
    );
    const hpMul = 1 + map.wall * 0.55;
    const rowsPlan = [
      { tx: x0, ty: y0, kind: "wall", w: ringW, h: thick, hpMul },
      { tx: x0, ty: y0 + ringH - thick, kind: "wall", w: ringW, h: thick, hpMul },
      { tx: x0, ty: y0 + thick, kind: "wall", w: thick, h: gateY - y0 - thick, hpMul },
      { tx: x0, ty: gateY, kind: "gate", w: thick, h: gateH, hpMul: hpMul * gateH },
      {
        tx: x0,
        ty: gateY + gateH,
        kind: "wall",
        w: thick,
        h: y0 + ringH - thick - gateY - gateH,
        hpMul,
      },
      {
        tx: x0 + ringW - thick,
        ty: y0 + thick,
        kind: "wall",
        w: thick,
        h: ringH - thick * 2,
        hpMul,
      },
    ];
    const loaded = blocks.loadLayout(rowsPlan);
    if (!loaded.ok) throw new Error("invalid authored fort: " + loaded.err);
    for (let i = 0; i < loaded.list.length; i++) {
      loaded.list[i].seed = 3100 + map.variant * 101 + i * 13 + ((rng() * 11) | 0);
      loaded.list[i].fort = true;
      if (loaded.list[i].kind === "gate") map.gate = loaded.list[i];
    }

    const t = tiles.t;
    const gateX = (x0 + thick * 0.5) * t;
    const gateCy = (gateY + gateH * 0.5) * t;
    const courtX = (x0 + Math.max(thick + 5, Math.round(ringW * 0.55))) * t;
    const outsideX = Math.max(70, (x0 - 5) * t);
    const defenderX = Math.min((x0 + ringW - thick - 5) * t, world.w - 70);
    const attackerSide = map.attackerSide;
    const defenderSide = map.defenderSide;
    map.deploy[attackerSide] = {
      x: outsideX,
      y: gateCy,
      head: 0,
      span: Math.max(150, Math.min(720, ringH * t * 0.62)),
      role: "attacker",
      exit: { x: 22, y: gateCy },
    };
    map.deploy[defenderSide] = {
      x: defenderX,
      y: gateCy,
      head: Math.PI,
      span: Math.max(150, Math.min(680, ringH * t * 0.55)),
      role: "defender",
      exit: { x: world.w - 22, y: gateCy },
    };
    map.objective = {
      kind: "breach",
      x: courtX,
      y: gateCy,
      r: 120,
      targetId: "main_gate",
      approach: { x: gateX - t * 1.6, y: gateCy },
      inside: { x: gateX + t * (thick + 1.2), y: gateCy },
    };
    /* A castle is a defended place, not an empty rectangle. Two compact
       courtyard wards reuse the sketch buildings while staying clear of the
       gate lane and objective. They are genuine collision, so street fighting
       continues after the breach. */
    const fortCy = (y0 + ringH * 0.5) * t;
    const wardOffset = ringH * t * 0.22;
    const wardSpread = Math.min(280, ringH * t * 0.19);
    world.towns = [
      { x: courtX + t * 5, y: fortCy - wardOffset, n: 3, spread: wardSpread },
      { x: courtX + t * 5, y: fortCy + wardOffset, n: 3, spread: wardSpread },
    ];
    ZS.Buildings.generate(world, nav);
    map.exits[0].y = gateCy;
    map.exits[0].side = attackerSide;
    map.exits[1].y = gateCy;
    map.exits[1].side = defenderSide;

    const roadY = ZS.clamp(gateY + ((gateH - 1) >> 1), 0, rows - 1);
    const roadEnd = Math.min(cols - 1, Math.ceil(courtX / t) + 2);
    for (let tx = Math.max(0, ((outsideX - t * 3) / t) | 0); tx <= roadEnd; tx++) {
      tiles.set(tx, roadY, ZS.Tiles.ROAD);
      const x = tx * t + t * 0.5;
      const i = nav.idx(x, roadY * t + t * 0.5);
      if (i >= 0) setSurface(map, i, SURFACE.ROAD);
    }
    paintRoad(
      map,
      [
        { x: Math.max(20, outsideX - t * 3), y: gateCy },
        { x: gateX, y: gateCy },
        { x: courtX, y: gateCy },
      ],
      52,
      3300 + map.variant,
      SURFACE.ROAD,
      false,
    );
    map.props.push({
      kind: "camp",
      x: outsideX * 0.62,
      y: gateCy - 180,
      w: 145,
      h: 90,
      faction: 0,
      seed: 3401,
    });
    map.props.push({
      kind: "camp",
      x: courtX + 120,
      y: gateCy + 180,
      w: 130,
      h: 82,
      faction: 1,
      seed: 3411,
    });
    /* Biome flavour sits away from the wall; it never changes the guaranteed
       gate/courtyard topology. */
    if (map.biome === "hill") {
      paintEllipse(map, outsideX * 0.7, world.h * 0.78, 180, 120, SURFACE.HILL, 3501, rng);
    } else if (map.biome === "wood") {
      paintEllipse(map, outsideX * 0.7, world.h * 0.78, 170, 120, SURFACE.WOOD, 3502, rng);
      addTrees(world, rng, outsideX * 0.7, world.h * 0.78, 150, 105, 16);
    } else if (map.biome === "marsh") {
      paintEllipse(map, outsideX * 0.7, world.h * 0.78, 180, 120, SURFACE.MARSH, 3503, rng);
    }
  }

  function flood(nav, x, y, collisionMask) {
    let start = nav.idx(x, y);
    if (start < 0 || !nav.isWalkable(x, y, collisionMask)) {
      const p = nav.nearestWalkable(x, y, 480, collisionMask);
      if (!p) return new Uint8Array(nav.n);
      start = nav.idx(p.x, p.y);
    }
    const seen = new Uint8Array(nav.n);
    const queue = new Int32Array(nav.n);
    let q0 = 0;
    let q1 = 0;
    queue[q1++] = start;
    seen[start] = 1;
    while (q0 < q1) {
      const i = queue[q0++];
      const ix = i % nav.w;
      const iy = (i / nav.w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = ix + FLOOD_DX[d];
        const ny = iy + FLOOD_DY[d];
        if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
        const ni = ny * nav.w + nx;
        if (seen[ni] || !nav.isWalkable(nx * CELL + 10, ny * CELL + 10, collisionMask)) continue;
        if (
          d >= 4 &&
          (!nav.isWalkable(nx * CELL + 10, iy * CELL + 10, collisionMask) ||
            !nav.isWalkable(ix * CELL + 10, ny * CELL + 10, collisionMask))
        ) {
          continue;
        }
        seen[ni] = 1;
        queue[q1++] = ni;
      }
    }
    return seen;
  }

  function isReachable(map, side, x, y) {
    const i = map.nav.idx(x, y);
    if (i < 0) return false;
    return !!map._reachFor(side)[i];
  }

  function carvePath(map, points, width, seed) {
    const nav = map.nav;
    const rr = width * width * 0.25;
    for (let iy = 0; iy < nav.h; iy++) {
      const y = iy * CELL + CELL * 0.5;
      for (let ix = 0; ix < nav.w; ix++) {
        const x = ix * CELL + CELL * 0.5;
        for (let p = 1; p < points.length; p++) {
          const a = points[p - 1];
          const b = points[p];
          if (pointSegmentDistance2(x, y, a.x, a.y, b.x, b.y) <= rr) {
            const i = iy * nav.w + ix;
            nav.val[i] = 1;
            nav.wm[i] = 0;
            setSurface(map, i, SURFACE.ROAD);
            break;
          }
        }
      }
    }
    map.roads.push({ points, width, seed, type: SURFACE.ROAD, repair: true });
    nav.version++;
    map._reachVersion[0] = -1;
    map._reachVersion[1] = -1;
  }

  function repairConnectivity(map) {
    const w = map.world.w;
    const h = map.world.h;
    if (map.kind === "fort") {
      const attackerSide = map.attackerSide;
      const defenderSide = map.defenderSide;
      if (!isReachable(map, attackerSide, map.objective.approach.x, map.objective.approach.y)) {
        carvePath(
          map,
          [
            map.deploy[attackerSide],
            { x: map.objective.approach.x, y: map.deploy[attackerSide].y },
            map.objective.approach,
          ],
          64,
          3901,
        );
      }
      if (!isReachable(map, defenderSide, map.objective.x, map.objective.y)) {
        carvePath(map, [map.deploy[defenderSide], map.objective], 64, 3902);
      }
      return;
    }
    for (let side = 0; side < 2; side++) {
      if (isReachable(map, side, map.objective.x, map.objective.y)) continue;
      /* A reserved northern bypass repairs a bad generated layout without an
         unbounded reroll and without cutting through the central town. */
      const by = Math.max(42, h * 0.11);
      carvePath(
        map,
        [
          map.deploy[side],
          { x: map.deploy[side].x, y: by },
          { x: map.objective.x, y: by },
          map.objective,
        ],
        Math.max(56, Math.min(84, w * 0.035)),
        4000 + side,
      );
    }
  }

  function mounted(type) {
    return type === 4 || type === 5 || type === 9 || type === 11;
  }

  function engine(type) {
    return type === 6 || type === 7;
  }

  function attachMethods(map) {
    map.collisionMask = function (_side, _type) {
      /* Sanguo formations use buildings and closed gates as solid masses.
         This also prevents a 100-man block from trying to funnel through an
         Outbreak house's two-cell door. */
      return this.kind !== "open";
    };

    map.speedMul = function (agent) {
      const i = this.nav.idx(agent.x, agent.y);
      if (i < 0) return 1;
      const type = agent.type | 0;
      const s = this.surface[i];
      let mul = 1;
      if (s === SURFACE.ROAD) mul = 1.05;
      else if (s === SURFACE.HILL) mul = engine(type) ? 0.74 : mounted(type) ? 0.82 : 0.9;
      else if (s === SURFACE.WOOD) mul = engine(type) ? 0.68 : mounted(type) ? 0.66 : 0.86;
      else if (s === SURFACE.MARSH) mul = engine(type) ? 0.48 : mounted(type) ? 0.56 : 0.72;
      else if (s === SURFACE.FORD) mul = mounted(type) ? 0.62 : 0.78;
      if (this.kind === "town" && mounted(type)) mul *= 0.88;
      return mul;
    };

    map._reachFor = function (side) {
      side = side === 1 ? 1 : 0;
      if (this._reachVersion[side] !== this.nav.version || !this._reach[side]) {
        const d = this.deploy[side];
        this._reach[side] = flood(this.nav, d.x, d.y, this.collisionMask(side, -1));
        this._reachVersion[side] = this.nav.version;
      }
      return this._reach[side];
    };

    map.normalizeGoal = function (side, x, y) {
      side = side === 1 ? 1 : 0;
      x = ZS.clamp(Number(x) || this.deploy[side].x, 12, this.world.w - 12);
      y = ZS.clamp(Number(y) || this.deploy[side].y, 12, this.world.h - 12);
      const reach = this._reachFor(side);
      const i = this.nav.idx(x, y);
      if (i >= 0 && reach[i] && this.nav.isWalkable(x, y, this.collisionMask(side, -1))) {
        return { x, y };
      }
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < reach.length; k++) {
        if (!reach[k]) continue;
        const cx = (k % this.nav.w) * CELL + CELL * 0.5;
        const cy = ((k / this.nav.w) | 0) * CELL + CELL * 0.5;
        const dx = cx - x;
        const dy = cy - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = k;
        }
      }
      return best >= 0
        ? this.nav.centerOf(best)
        : { x: this.deploy[side].x, y: this.deploy[side].y };
    };

    map.drawGround = function (c, t) {
      if (this.tiles) this.tiles.drawAll(c);
      const env = ZS.env;
      for (let i = 0; i < this.roads.length; i++) {
        const road = this.roads[i];
        if (env && env.road) env.road(c, road.points, road.width, road.seed);
      }
      for (let i = 0; i < this.props.length; i++) {
        const p = this.props[i];
        if (p.kind === "patch") {
          c.fillStyle =
            p.type === SURFACE.HILL
              ? "rgba(154,142,96,0.11)"
              : p.type === SURFACE.WOOD
                ? "rgba(104,132,66,0.10)"
                : "rgba(92,134,126,0.11)";
          c.strokeStyle = "rgba(61,52,43,0.16)";
          c.lineWidth = 1;
          ZS.wpoly(c, p.pts, p.seed, 1.1, true);
          c.fill();
          c.stroke();
        } else if (p.kind === "hill" && env && env.hill) env.hill(c, p.x, p.y, p.w, p.h, p.seed);
        else if (p.kind === "bridge" && env && env.bridge) env.bridge(c, p.x, p.y, p.w, p.seed);
        else if (p.kind === "camp" && env && env.camp)
          env.camp(c, p.x, p.y, p.w, p.h, p.faction, p.seed);
        else if (p.kind === "ruins" && env && env.ruins) env.ruins(c, p.x, p.y, p.r, p.seed);
      }
      void t;
    };

    map.drawBlock = function (c, b, _t) {
      const env = ZS.env;
      const hp = b.maxHp > 0 ? ZS.clamp(b.hp / b.maxHp, 0, 1) : 0;
      const seed = b.seed || b.tx * 37 + b.ty * 71;
      const w = b.x1 - b.x0;
      const h = b.by - b.y0;
      if (b.kind === "gate" && env && env.gate) {
        c.save();
        c.translate((b.x0 + b.x1) * 0.5, (b.y0 + b.by) * 0.5);
        if (h > w) c.rotate(Math.PI * 0.5);
        env.gate(c, 0, 0, Math.max(w, h), seed);
        c.restore();
        return;
      }
      if (b.kind === "wall" && env && env.wall) {
        if (w >= h) {
          const y = b.by - h * 0.25;
          env.wall(c, b.x0, y, b.x1, y, hp, seed);
        } else {
          const x = b.x0 + w * 0.5;
          env.wall(c, x, b.y0, x, b.by, hp, seed);
        }
        return;
      }
      c.fillStyle = "rgba(160,140,110,0.30)";
      c.strokeStyle = "rgba(61,52,43,0.72)";
      ZS.sketchRect(c, b.x0, b.y0, w, h);
    };

    map.damageGate = function (amount) {
      if (!this.gate || this.gate.broken || this.gate.hp <= 0 || !this.blocks) return false;
      const broke = this.blocks.damage(this.gate, Math.max(0, Number(amount) || 0));
      if (broke) this.gate.broken = true;
      return broke;
    };

    map.validate = function () {
      const errors = [];
      if (this.surface.length !== this.nav.n || this.moveCost.length !== this.nav.n) {
        errors.push("terrain grids do not match nav");
      }
      for (let side = 0; side < 2; side++) {
        const d = this.deploy[side];
        if (!this.nav.isWalkable(d.x, d.y, this.collisionMask(side, -1))) {
          errors.push("deployment " + side + " is blocked");
        }
      }
      if (this.kind === "fort") {
        const attackerSide = this.attackerSide;
        const defenderSide = this.defenderSide;
        if (!this.gate) errors.push("fort has no gate");
        if (
          !isReachable(this, attackerSide, this.objective.approach.x, this.objective.approach.y)
        ) {
          errors.push("attacker cannot reach the gate approach");
        }
        if (!isReachable(this, defenderSide, this.objective.x, this.objective.y)) {
          errors.push("defender cannot reach the courtyard");
        }
        if (
          this.gate &&
          !this.gate.broken &&
          isReachable(this, attackerSide, this.objective.x, this.objective.y)
        ) {
          errors.push("closed fort gate does not seal the courtyard");
        }
      } else {
        for (let side = 0; side < 2; side++) {
          if (!isReachable(this, side, this.objective.x, this.objective.y)) {
            errors.push("deployment " + side + " cannot reach objective");
          }
        }
      }
      if (this.kind === "town" && !this.world.buildings.length)
        errors.push("town has no buildings");
      return { ok: errors.length === 0, errors };
    };
  }

  function create(field, world, nav, seed) {
    if (!world || !nav) throw new Error("Battlefield.create needs world and nav");
    seed = seed | 0 || world.seed | 0 || 20250830;
    resetWorld(world, nav, seed);
    const map = baseDescriptor(field, world, nav, seed);
    if (map.kind === "town") buildTown(map);
    else if (map.kind === "fort") buildFort(map);
    else buildOpen(map);
    repairConnectivity(map);
    world.battlefield = map;
    return map;
  }

  const Battlefield = { create, SURFACE, COST, BIOMES: BIOMES.slice(), KINDS: KINDS.slice() };
  ZS.Battlefield = Battlefield;
})();
