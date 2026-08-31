/* Blocks: one-tile built objects for tile battlefields (the Hold).
   A block sits on a tile and claims its nav cells: walls, generators and
   the core are hard blocks (0); a gate is an intact door (3) — humans pass,
   zombies can't, and a broken gate becomes plain land. Broken blocks hand
   their tile back as rubble. The scenario owns the rules (costs, refund,
   what attacks what); this owns the grid, placement validation, and
   HP/cracks. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  // kind -> base stats. Costs live in the scenario (BAL).
  const CAT = {
    wall: { hp: 200, nav: 0 },
    gate: { hp: 120, nav: 3 }, // intact door: humans pass, zombies blocked
    yard: { hp: 60, nav: 0 },
    farm: { hp: 60, nav: 0 },
    barracks: { hp: 100, nav: 0 },
    turret: { hp: 150, nav: 0 },
    workshop: { hp: 120, nav: 0 },
    core: { hp: 1000, nav: 0 },
  };
  const CORES = ["wall", "gate"]; // must touch the settlement or a block
  const GENS = ["yard", "farm", "barracks", "turret", "workshop"]; // need open sky

  class Blocks {
    constructor(world, nav, tiles) {
      this.world = world;
      this.nav = nav;
      this.tiles = tiles;
      this.t = ZS.Tiles.TILE;
      this.cols = tiles.cols;
      this.rows = tiles.rows;
      this.grid = new Int16Array(this.cols * this.rows).fill(-1);
      this.list = [];
      this.core = null;
    }

    idx(tx, ty) {
      return ty * this.cols + tx;
    }

    inGrid(tx, ty) {
      return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
    }

    at(tx, ty) {
      if (!this.inGrid(tx, ty)) return null;
      const i = this.grid[this.idx(tx, ty)];
      return i < 0 ? null : this.list[i];
    }

    // the settlement: a fixed 2x2 core in the middle of the map
    placeCore() {
      const tx = (this.cols / 2) | 0,
        ty = (this.rows / 2) | 0;
      this.core = this._add(tx - 1, ty - 1, "core", 2, 2, CAT.core.hp);
      return this.core;
    }

    _add(tx, ty, kind, w, h, hp) {
      const b = {
        tx,
        ty,
        w,
        h,
        kind,
        hp,
        maxHp: hp,
        cracks: 0,
        x0: tx * this.t,
        y0: ty * this.t,
        x1: (tx + w) * this.t,
        by: (ty + h) * this.t, // y-sort key: the block's bottom edge
        aim: 0,
      };
      this.list.push(b);
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) this.grid[this.idx(tx + dx, ty + dy)] = this.list.length - 1;
      this.nav.markRect(b.x0, b.y0, b.x1 - b.x0, b.by - b.y0, CAT[kind].nav);
      this.nav.version++;
      return b;
    }

    // placement rules (design §3.2): grass/sand/road only, walls must touch
    // the settlement, generators need one tile of open sky around them
    checkPlace(tx, ty, kind) {
      if (!CAT[kind]) return { ok: false, err: "unknown block" };
      if (!this.inGrid(tx, ty) || this.at(tx, ty))
        return { ok: false, err: "something is already there" };
      const t = this.tiles.typeAt(tx, ty);
      if (t !== 0 && t !== 2 && t !== 3) return { ok: false, err: "build on grass, sand or road" };
      const n = [
        this.at(tx, ty - 1),
        this.at(tx, ty + 1),
        this.at(tx - 1, ty),
        this.at(tx + 1, ty),
      ];
      if (CORES.includes(kind) && !n.some((b) => b))
        return { ok: false, err: "walls must touch the settlement" };
      if (GENS.includes(kind) && !n.some((b) => !b))
        return { ok: false, err: "needs open sky around it" };
      return { ok: true };
    }

    place(tx, ty, kind, hpMul = 1) {
      const chk = this.checkPlace(tx, ty, kind);
      if (!chk.ok) return chk;
      const b = this._add(tx, ty, kind, 1, 1, Math.round(CAT[kind].hp * hpMul));
      return { ok: true, b };
    }

    /* Cold-path authored placement. The Hold's interactive `place()` keeps
       its adjacency/open-sky rules; a scenario-owned castle already *is* the
       authority on its layout and needs to stamp long wall runs without
       pretending to build outward from the Hold's settlement core. */
    stamp(tx, ty, kind, w = 1, h = 1, hpMul = 1) {
      const chk = this.checkStamp(tx, ty, kind, w, h);
      if (!chk.ok) return chk;
      const b = this._add(
        tx | 0,
        ty | 0,
        kind,
        w | 0,
        h | 0,
        Math.round(CAT[kind].hp * Math.max(0.01, Number(hpMul) || 1)),
      );
      if (kind === "core") this.core = b;
      return { ok: true, b };
    }

    checkStamp(tx, ty, kind, w = 1, h = 1) {
      tx |= 0;
      ty |= 0;
      w |= 0;
      h |= 0;
      if (!CAT[kind]) return { ok: false, err: "unknown block" };
      if (w < 1 || h < 1) return { ok: false, err: "invalid footprint" };
      if (!this.inGrid(tx, ty) || !this.inGrid(tx + w - 1, ty + h - 1)) {
        return { ok: false, err: "outside the battlefield" };
      }
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (this.at(tx + dx, ty + dy)) return { ok: false, err: "something is already there" };
          const ground = this.tiles.typeAt(tx + dx, ty + dy);
          if (ground !== 0 && ground !== 2 && ground !== 3) {
            return { ok: false, err: "build on grass, sand or road" };
          }
        }
      }
      return { ok: true };
    }

    /* Validate the whole authored plan before mutating anything. This avoids
       half a fort surviving when one late segment overlaps a corner. Rows are
       `{tx, ty, kind, w?, h?, hpMul?}`. */
    loadLayout(rows) {
      if (!Array.isArray(rows)) return { ok: false, err: "layout must be an array" };
      const claimed = new Set();
      for (const row of rows) {
        const tx = row && row.tx;
        const ty = row && row.ty;
        const w = (row && row.w) || 1;
        const h = (row && row.h) || 1;
        const kind = row && row.kind;
        const chk = this.checkStamp(tx, ty, kind, w, h);
        if (!chk.ok) return chk;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const key = this.idx((tx | 0) + dx, (ty | 0) + dy);
            if (claimed.has(key)) return { ok: false, err: "layout footprints overlap" };
            claimed.add(key);
          }
        }
      }
      const list = [];
      for (const row of rows) {
        const out = this.stamp(row.tx, row.ty, row.kind, row.w || 1, row.h || 1, row.hpMul || 1);
        if (!out.ok) return out; // preflight above makes this defensive only
        list.push(out.b);
      }
      return { ok: true, list };
    }

    remove(b, toRubble = true) {
      const i = this.list.indexOf(b);
      if (i >= 0) {
        const last = this.list.length - 1;
        if (i !== last) {
          this.list[i] = this.list[last]; // moved into slot i: re-stamp its cells
          const m = this.list[i];
          for (let dy = 0; dy < m.h; dy++)
            for (let dx = 0; dx < m.w; dx++) this.grid[this.idx(m.tx + dx, m.ty + dy)] = i;
        }
        this.list.pop();
      }
      for (let dy = 0; dy < b.h; dy++)
        for (let dx = 0; dx < b.w; dx++) this.grid[this.idx(b.tx + dx, b.ty + dy)] = -1;
      if (b === this.core) this.core = null;
      if (toRubble) {
        const t = this.tiles;
        for (let dy = 0; dy < b.h; dy++)
          for (let dx = 0; dx < b.w; dx++) t.set(b.tx + dx, b.ty + dy, ZS.Tiles.RUBBLE);
        // a broken gate frees its door cell; tiles.set only flips water
        this.nav.markRect(b.x0, b.y0, b.x1 - b.x0, b.by - b.y0, 1);
      }
      this.nav.version++;
    }

    damage(b, amt) {
      b.hp -= amt;
      const f = b.hp / b.maxHp;
      b.cracks = f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : 3;
      if (b.hp <= 0) {
        this.remove(b, true);
        return true;
      }
      return false;
    }
  }

  Blocks.CAT = CAT;
  Blocks.GENS = GENS;

  ZS.Blocks = Blocks;
})();
