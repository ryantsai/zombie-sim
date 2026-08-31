/* Tiles: an optional square ground grid for tile-based battlefields (the Hold).
   The scenario owns the rules — budget, tools, when digging is allowed; this
   owns the grid, the nav marking (water is a hard block, sand/road are plain
   land), and the per-frame sketch render: washes under everything, boiling
   outlines where water meets land.

   One tile = TILE px = a 2x2 block of nav cells, so dug lines land exactly
   on the nav grid. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const TILE = 40;

  class Tiles {
    constructor(world, nav) {
      this.world = world;
      this.nav = nav;
      this.t = TILE;
      this.cols = Math.max(1, Math.round(world.w / TILE));
      this.rows = Math.max(1, Math.round(world.h / TILE));
      this.g = new Uint8Array(this.cols * this.rows); // 0 grass, 1 water, 2 sand, 3 road
      this.edges = []; // water/land border segments, rebuilt on every change
    }

    idx(tx, ty) {
      return ty * this.cols + tx;
    }

    inGrid(tx, ty) {
      return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
    }

    typeAt(tx, ty) {
      return this.inGrid(tx, ty) ? this.g[this.idx(tx, ty)] : 0;
    }

    // change one tile; true when it actually changed (the scenario charges for that)
    set(tx, ty, type) {
      if (!this.inGrid(tx, ty) || this.g[this.idx(tx, ty)] === type) return false;
      const i = this.idx(tx, ty);
      this.g[i] = type;
      const x = tx * TILE,
        y = ty * TILE;
      if (type === 1)
        this.nav.markRect(x, y, TILE, TILE, 0); // water: hard block
      else this.nav.markRect(x, y, TILE, TILE, 1, 0); // land, only where water was
      this.rebuildEdges();
      return true;
    }

    // Paint a straight stroke from (x0,y0) to (x1,y1); returns tiles changed.
    // `limit` and `canSet` are optional scenario rules (the Hold uses them to
    // enforce its dig purse and to keep terrain out from under buildings).
    stroke(x0, y0, x1, y1, type, limit = Infinity, canSet = null) {
      if (limit <= 0) return 0;
      let n = 0;
      let [tx, ty] = this.tileAt(x0, y0);
      const [ex, ey] = this.tileAt(x1, y1);
      const dx = Math.abs(ex - tx),
        dy = Math.abs(ey - ty);
      const sx = tx < ex ? 1 : -1,
        sy = ty < ey ? 1 : -1;
      let err = dx - dy;
      for (let guard = 0; guard < this.cols + this.rows + 2; guard++) {
        if ((!canSet || canSet(tx, ty)) && this.set(tx, ty, type)) {
          n++;
          if (n >= limit) break;
        }
        if (tx === ex && ty === ey) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          tx += sx;
        }
        if (e2 < dx) {
          err += dx;
          ty += sy;
        }
      }
      return n;
    }

    tileAt(x, y) {
      return [Math.floor(x / TILE), Math.floor(y / TILE)];
    }

    // water/land border segments (the boiling outline runs along these)
    rebuildEdges() {
      this.edges.length = 0;
      const E = this.edges;
      for (let ty = 0; ty < this.rows; ty++) {
        for (let tx = 0; tx < this.cols; tx++) {
          if (this.g[this.idx(tx, ty)] !== 1) continue;
          const x = tx * TILE,
            y = ty * TILE,
            s = tx * 13.77 + ty * 57.31;
          if (this.typeAt(tx, ty - 1) !== 1)
            E.push({ x1: x, y1: y, x2: x + TILE, y2: y, seed: s + 1 });
          if (this.typeAt(tx, ty + 1) !== 1)
            E.push({ x1: x, y1: y + TILE, x2: x + TILE, y2: y + TILE, seed: s + 2 });
          if (this.typeAt(tx - 1, ty) !== 1)
            E.push({ x1: x, y1: y, x2: x, y2: y + TILE, seed: s + 3 });
          if (this.typeAt(tx + 1, ty) !== 1)
            E.push({ x1: x + TILE, y1: y, x2: x + TILE, y2: y + TILE, seed: s + 4 });
        }
      }
    }

    // per-frame pass (camera transform already applied): washes, then the
    // boiling water border on top
    drawAll(c) {
      for (let ty = 0; ty < this.rows; ty++) {
        for (let tx = 0; tx < this.cols; tx++) {
          const v = this.g[this.idx(tx, ty)];
          if (!v) continue;
          const x = tx * TILE,
            y = ty * TILE;
          if (v === 1) {
            c.fillStyle = "rgba(96,138,166,0.26)"; // same wash as the river
            c.fillRect(x, y, TILE, TILE);
          } else if (v === 2) {
            c.fillStyle = "rgba(203,183,138,0.30)";
            c.fillRect(x, y, TILE, TILE);
            c.strokeStyle = "rgba(150,130,90,0.4)";
            c.lineWidth = 1;
            const s = tx * 3.1 + ty * 11.3;
            ZS.wcirc(c, x + 12 + ZS.sjit(s) * 4, y + 14, 1.3, s + 1, 0.3);
            ZS.wcirc(c, x + 28 + ZS.sjit(s + 2) * 4, y + 26, 1.3, s + 3, 0.3);
          } else if (v === 3) {
            c.fillStyle = "rgba(125,108,88,0.16)";
            c.fillRect(x, y, TILE, TILE);
            c.strokeStyle = "rgba(110,95,75,0.35)";
            c.lineWidth = 1.2;
            ZS.wline(c, x + 4, y + TILE / 2, x + TILE - 4, y + TILE / 2, tx * 7.7 + ty * 3.1, 1.2);
          } else if (v === 4) {
            // rubble: hatch marks + a few pebbles
            c.strokeStyle = "rgba(110,95,75,0.4)";
            c.lineWidth = 1.1;
            const s = tx * 5.3 + ty * 9.7;
            ZS.wline(c, x + 6, y + 30, x + 22, y + 10, s + 1, 1.4);
            ZS.wline(c, x + 16, y + 32, x + 34, y + 12, s + 2, 1.4);
            ZS.wline(c, x + 8, y + 14, x + 14, y + 8, s + 3, 0.8);
            ZS.wcirc(c, x + 28 + ZS.sjit(s + 4) * 5, y + 28, 1.6, s + 4, 0.3);
            ZS.wcirc(c, x + 12 + ZS.sjit(s + 5) * 5, y + 22, 1.4, s + 5, 0.3);
          }
        }
      }
      if (this.edges.length) {
        c.lineCap = "round";
        c.lineWidth = 2;
        c.strokeStyle = "rgba(64,102,132,0.75)"; // same ink as the river outline
        for (const e of this.edges) ZS.wline(c, e.x1, e.y1, e.x2, e.y2, e.seed, 1.6);
      }
    }
  }

  Tiles.GRASS = 0;
  Tiles.WATER = 1;
  Tiles.SAND = 2;
  Tiles.ROAD = 3;
  Tiles.RUBBLE = 4;
  Tiles.TILE = TILE;

  ZS.Tiles = Tiles;
})();
