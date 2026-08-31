/* ZS.CampaignMap — the province graph and the paper sheet it is drawn on
   (docs/SANGUO-DESIGN.md §4.1, §7.6).

   Two jobs, deliberately kept apart:

   1. **The graph.** Adjacency, march cost in turns, and shortest path. Pure
      data derived once from js/campaign/data/provinces.js. Nothing here knows
      who owns what — that is campaign state, and it is passed in.

   2. **The sheet.** Province territory as wobbly ink borders on paper. The
      borders are real Voronoi cells over the commandery seats, clipped to the
      map rectangle: territory is contiguous, every point of the empire belongs
      to exactly one province, and "which province did I click" is just
      "which seat is nearest". Hand-drawing 57 blobs would have neither
      property.

   The static half of the sheet (borders, rivers, hills, roads, seats) is
   pre-rendered once into an offscreen canvas, the way js/app.js pre-renders
   its paper wash — the boil is frozen there, which is right for a map that is
   supposed to be a drawn object rather than a live scene. The live half
   (ownership wash, banners, army tokens, selection) draws per frame and keeps
   its shimmer.

   Polygons are built once and reused, never rebuilt per frame — AGENTS.md
   constraint 5. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const INK = "#3d342b";
  const INK_SOFT = "rgba(61,52,43,0.5)";
  const INK_FAINT = "rgba(61,52,43,0.20)";

  /* Map units a stack covers in one season. Most neighbours are one turn
     apart; a haul across Liang or down to Jiaozhi is two or three. */
  const MARCH_PER_TURN = 95;

  /* Decorative brushwork. The two rivers that decide where armies can go in
     every telling of this war; drawn, not simulated. P4's `field.kind` is what
     actually puts a river on a battlefield. */
  const RIVERS = [
    // 黃河 — Longxi down to the sea at Bohai
    [
      { x: 340, y: 210 },
      { x: 440, y: 248 },
      { x: 520, y: 262 },
      { x: 600, y: 258 },
      { x: 664, y: 246 },
      { x: 716, y: 262 },
      { x: 762, y: 272 },
      { x: 806, y: 262 },
      { x: 846, y: 236 },
      { x: 878, y: 214 },
    ],
    // 長江 — the gorges out to the delta
    [
      { x: 396, y: 392 },
      { x: 470, y: 428 },
      { x: 546, y: 452 },
      { x: 618, y: 464 },
      { x: 692, y: 470 },
      { x: 764, y: 458 },
      { x: 812, y: 452 },
      { x: 856, y: 470 },
      { x: 906, y: 484 },
    ],
  ];

  const Map_ = {
    built: false,
    size: { w: 1000, h: 700 },
    list: [],
    byId: new Map(),
    adj: new Map(), // id -> [{ id, cost }]
    polys: new Map(), // id -> [{x,y}]
    _sheet: null,
    _sheetKey: "",

    build() {
      if (this.built) return this;
      const src = ZS.data.provinces;
      this.size = ZS.data.mapSize || this.size;
      this.list = src;
      for (const p of src) this.byId.set(p.id, p);

      for (const p of src) this.adj.set(p.id, []);
      for (const [a, b] of ZS.data.provinceEdges) {
        const pa = this.byId.get(a),
          pb = this.byId.get(b);
        if (!pa || !pb) continue; // a typo in the data must not crash the map
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const cost = Math.max(1, Math.round(d / MARCH_PER_TURN));
        this.adj.get(a).push({ id: b, cost });
        this.adj.get(b).push({ id: a, cost });
      }

      for (const p of src) this.polys.set(p.id, voronoiCell(p, src, this.size));
      this.built = true;
      return this;
    },

    province(id) {
      return this.byId.get(id) || null;
    },

    neighbours(id) {
      return this.adj.get(id) || [];
    },

    isNeighbour(a, b) {
      const ns = this.adj.get(a);
      if (!ns) return false;
      for (const n of ns) if (n.id === b) return true;
      return false;
    },

    cost(a, b) {
      const ns = this.adj.get(a);
      if (!ns) return Infinity;
      for (const n of ns) if (n.id === b) return n.cost;
      return Infinity;
    },

    /* Dijkstra over march cost. `blocked(id)` may refuse a province — an army
       will not path through hostile ground, but the destination itself is
       always allowed, because marching into it is the point. Returns the id
       chain including both ends, or null. 57 nodes: a linear scan beats a heap
       and keeps this readable. */
    path(from, to, blocked) {
      if (from === to) return [from];
      if (!this.byId.has(from) || !this.byId.has(to)) return null;
      const dist = new Map([[from, 0]]);
      const prev = new Map();
      const seen = new Set();
      for (;;) {
        let cur = null,
          best = Infinity;
        for (const [id, d] of dist) {
          if (!seen.has(id) && d < best) {
            best = d;
            cur = id;
          }
        }
        if (cur === null) return null;
        if (cur === to) break;
        seen.add(cur);
        for (const n of this.adj.get(cur)) {
          if (seen.has(n.id)) continue;
          if (blocked && n.id !== to && blocked(n.id)) continue;
          const nd = best + n.cost;
          if (nd < (dist.has(n.id) ? dist.get(n.id) : Infinity)) {
            dist.set(n.id, nd);
            prev.set(n.id, cur);
          }
        }
      }
      const out = [to];
      let c = to;
      while (c !== from) {
        c = prev.get(c);
        if (c === undefined) return null;
        out.push(c);
      }
      out.reverse();
      return out;
    },

    pathCost(ids) {
      let sum = 0;
      for (let i = 1; i < ids.length; i++) sum += this.cost(ids[i - 1], ids[i]);
      return sum;
    },

    poly(id) {
      return this.polys.get(id) || null;
    },

    /* Voronoi means nearest seat wins, so hit-testing is a scan and never a
       point-in-polygon test. Off-sheet points return null. */
    at(x, y) {
      if (x < 0 || y < 0 || x > this.size.w || y > this.size.h) return null;
      let best = null,
        bd = Infinity;
      for (const p of this.list) {
        const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < bd) {
          bd = d;
          best = p.id;
        }
      }
      return best;
    },

    /* ---- the sheet -------------------------------------------------- */

    /* The static drawing, pre-rendered at `scale` device pixels per map unit.
       Cached on the scale so a resize rebuilds it and a pan does not. */
    sheet(scale) {
      const s = Math.max(0.35, Math.min(2, scale || 1));
      const key = s.toFixed(2);
      if (this._sheet && this._sheetKey === key) return this._sheet;
      const cv = document.createElement("canvas");
      cv.width = Math.round(this.size.w * s);
      cv.height = Math.round(this.size.h * s);
      const c = cv.getContext("2d");
      c.scale(s, s);
      drawSheet(c, this);
      this._sheet = cv;
      this._sheetKey = key;
      return cv;
    },

    /* Called when the viewport changes enough that the cached sheet is coarse.
       Cheap: the next sheet() call rebuilds. */
    invalidateSheet() {
      this._sheet = null;
      this._sheetKey = "";
    },
  };

  /* ---- Voronoi ------------------------------------------------------ */

  /* The map rectangle clipped by the perpendicular bisector against every
     other seat (Sutherland-Hodgman, one half-plane at a time). O(n^2) over 57
     seats, run once at build. */
  function voronoiCell(site, sites, size) {
    let poly = [
      { x: 0, y: 0 },
      { x: size.w, y: 0 },
      { x: size.w, y: size.h },
      { x: 0, y: size.h },
    ];
    for (const other of sites) {
      if (other === site) continue;
      const dx = other.x - site.x,
        dy = other.y - site.y;
      // keep the half-plane nearer `site`: dx*x + dy*y <= dot at the midpoint
      const lim = (dx * (site.x + other.x) + dy * (site.y + other.y)) / 2;
      poly = clipHalfPlane(poly, dx, dy, lim);
      if (poly.length < 3) return [];
    }
    return poly;
  }

  function clipHalfPlane(poly, ax, ay, lim) {
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i],
        q = poly[(i + 1) % n];
      const dp = ax * p.x + ay * p.y - lim;
      const dq = ax * q.x + ay * q.y - lim;
      const pin = dp <= 0,
        qin = dq <= 0;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = dp / (dp - dq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    return out;
  }

  /* ---- the static drawing -------------------------------------------- */

  function drawSheet(c, map) {
    const W = map.size.w,
      H = map.size.h;

    c.fillStyle = "#f0e9d8";
    c.fillRect(0, 0, W, H);

    // a faint speckle so the sheet is paper and not a swatch
    for (let i = 0; i < 1800; i++) {
      const x = ((ZS.sjit(i * 1.9 + 3) + 1) / 2) * W;
      const y = ((ZS.sjit(i * 4.1 + 17) + 1) / 2) * H;
      const a = 0.02 + ((ZS.sjit(i * 6.3 + 5) + 1) / 2) * 0.05;
      c.fillStyle = "rgba(120,105,80," + a.toFixed(3) + ")";
      c.fillRect(x, y, 1, 1);
    }

    c.lineCap = "round";
    c.lineJoin = "round";

    // the two great rivers, under everything
    for (let i = 0; i < RIVERS.length; i++) ZS.env.river(c, RIVERS[i], 9 - i * 2, 400 + i * 37);

    /* Terrain is a hint, not a subject. One motif per province instead of two,
       set well clear of the seat — the seat's own 60 px carries the flag, the
       name and any stack standing there, and the old pair of hills landed
       inside it. Drawn through `terrain()` at low alpha so it stays under the
       ownership wash rather than competing with it. */
    c.save();
    c.globalAlpha = 0.42;
    for (const p of map.list) {
      const seed = hashId(p.id);
      if (p.biome === "hill") ZS.env.hill(c, p.x - 30, p.y + 30, 46, 15, seed);
      else if (p.biome === "wood") ZS.env.tree(c, p.x - 26, p.y + 34, 8, "pine", seed);
    }
    c.restore();

    /* Routes under the borders, not over them: an edge is a road between two
       seats, and reading it as a border was half the map's confusion. Faint
       enough to be a texture until the player is looking for one. */
    c.strokeStyle = "rgba(120,100,80,0.20)";
    c.lineWidth = 1;
    c.setLineDash([5, 5]);
    for (const [a, b] of ZS.data.provinceEdges) {
      const pa = map.byId.get(a),
        pb = map.byId.get(b);
      if (!pa || !pb) continue;
      ZS.wline(c, pa.x, pa.y, pb.x, pb.y, hashId(a + b), 1.1);
    }
    c.setLineDash([]);

    // province borders, last of the static layers so they read as the division
    c.strokeStyle = INK_FAINT;
    c.lineWidth = 1.2;
    for (const p of map.list) {
      const poly = map.polys.get(p.id);
      if (!poly || poly.length < 3) continue;
      ZS.wpoly(c, poly, hashId(p.id) * 3.1, 1.6, true);
      c.stroke();
    }

    // the sheet's own frame, drawn last so it sits over the wash
    c.strokeStyle = INK_SOFT;
    ZS.sketchRect(c, 8, 8, W - 16, H - 16);
  }

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (Math.abs(h) % 9000) * 0.017 + 1;
  }

  Map_.RIVERS = RIVERS;
  Map_.MARCH_PER_TURN = MARCH_PER_TURN;
  Map_.hashId = hashId;
  Map_.INK = INK;
  Map_.INK_SOFT = INK_SOFT;
  Map_.INK_FAINT = INK_FAINT;

  ZS.CampaignMap = Map_;

  /* Built at load rather than on first use. It is one pass of Voronoi over 57
     seats — a few milliseconds — and it removes a whole class of bug: every
     lookup here answers `null` until build() has run, so any caller that got
     there first (the faction picker did) blew up on a null province. The data
     files are loaded before this one, so there is nothing to wait for. */
  Map_.build();
})();
