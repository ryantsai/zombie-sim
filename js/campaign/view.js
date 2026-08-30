/* ZS.CampaignView — the campaign as something you look at and click
   (docs/SANGUO-DESIGN.md §2, §4.1, §7.6).

   The canvas draws the map; every button is DOM (js/ui/campaign.js). Same
   split as the menu and the battle, for the same reasons — focus order,
   keyboard, and a locale switch that refills text for free.

   Layers, back to front:
     1. the sheet      pre-rendered once by js/campaign/map.js — paper, rivers,
                       hills, borders, routes. Frozen boil: it is a drawn map.
     2. ownership      a faction-tinted wash inside each province polygon
     3. seats          the city glyph and its name
     4. banners        a planted flag at each capital
     5. tokens         armies, marching or standing
     6. selection      the selected province, the selected stack, its route

   Layers 2-6 boil with everything else, which is what keeps the map feeling
   like the same hand as the battle.

   Input follows the map, not the battlefield: there is no box-select here, so
   **left-drag pans** and a left *click* selects. Right-click orders the
   selected stack to march, the same verb it has in battle. Wheel zooms.

   Per-frame allocation: none. The polygons come from CampaignMap and are
   reused, the visible-set scratch arrays are hoisted, and nothing builds a
   record inside draw() (AGENTS.md constraint 5). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const INK = "#3d342b";
  const INK_SOFT = "rgba(61,52,43,0.5)";
  const DRAG_SLOP = 5; // px of movement before a click becomes a pan

  /* Zoom thresholds — what is worth drawing at what scale. */
  const Z_NAME = 0.62;
  const Z_DETAIL = 1.0;

  const View = {
    ownsLoop: false,
    music: "menu",
    camp: null,
    cam: null,
    W: 0,
    H: 0,
    selProvince: null,
    selArmy: null,
    tt: 0,
    _listeners: null,
    _drag: null,
    _sheetScale: 0,

    /* ---- lifecycle ---------------------------------------------------- */

    enter(payload) {
      const map = ZS.CampaignMap.build();
      /* A campaign may arrive three ways: handed in (new game), already on the
         shell (a load), or absent (defensive — start one rather than crash). */
      this.camp =
        (payload && payload.campaign) ||
        ZS.App.campaign ||
        ZS.Campaign.create(Date.now() | 0, ZS.data.factions[0].id);
      ZS.App.campaign = this.camp;

      this.cam = new ZS.Camera({ w: map.size.w, h: map.size.h });
      this.cam.minZoom = 0.3;
      this.cam.maxZoom = 3;
      this.cam.fit(this.W || window.innerWidth, this.H || window.innerHeight);

      this.selProvince = null;
      this.selArmy = null;
      this.tt = 0;
      /* Last, because it is what decides where you are looking and what is
         selected — clearing the selection after it would undo the point. */
      this.focusCapital();
      this.attach();
      if (ZS.CampaignUI) ZS.CampaignUI.onEnter(this);
    },

    exit() {
      this.detach();
      if (ZS.CampaignUI) ZS.CampaignUI.onExit();
      this.camp = null;
      this.cam = null;
      this.selProvince = null;
      this.selArmy = null;
    },

    resize(w, h) {
      this.W = w;
      this.H = h;
      if (this.cam) this.cam.clamp(w, h);
    },

    focusCapital() {
      const fd = this.camp.factionDef(this.camp.playerFactionId);
      const held = this.camp.provincesOf(this.camp.playerFactionId);
      const id = fd && this.camp.owner(fd.capital) === fd.id ? fd.capital : held[0];
      const p = id ? ZS.CampaignMap.province(id) : null;
      if (!p) return;
      this.cam.zoom = 1.1;
      this.cam.x = p.x;
      this.cam.y = p.y;
      this.cam.clamp(this.W || window.innerWidth, this.H || window.innerHeight);
      this.selProvince = id;
    },

    /* ---- selection ----------------------------------------------------- */

    selectProvince(id) {
      this.selProvince = id;
      /* Selecting a province does not drop the stack you were commanding —
         you often want to look at where you are sending it. */
      if (ZS.CampaignUI) ZS.CampaignUI.refresh();
    },

    selectArmy(id) {
      this.selArmy = id;
      const a = id ? this.camp.armies[id] : null;
      if (a) this.selProvince = a.at;
      if (ZS.CampaignUI) ZS.CampaignUI.refresh();
    },

    /* The player's own stack nearest a world point, within a token's reach. */
    armyAt(wx, wy) {
      const camp = this.camp;
      let best = null,
        bd = 22 * 22;
      for (const id in camp.armies) {
        const a = camp.armies[id];
        const p = ZS.Army.position(a, ZS.CampaignMap);
        if (!p) continue;
        const d = (p.x - wx) * (p.x - wx) + (p.y - wy) * (p.y - wy);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      return best;
    },

    /* ---- input ---------------------------------------------------------- */

    attach() {
      if (this._listeners) return;
      const cv = ZS.App.cv;
      const L = (this._listeners = []);
      const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        L.push([target, type, fn, opts]);
      };

      on(cv, "contextmenu", (e) => e.preventDefault());

      on(cv, "pointerdown", (e) => {
        if (e.button === 2) return; // handled on pointerup so a drag can cancel
        this._drag = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          x0: e.clientX,
          y0: e.clientY,
          moved: false,
          button: e.button,
        };
        cv.setPointerCapture(e.pointerId);
      });

      on(cv, "pointermove", (e) => {
        const d = this._drag;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_SLOP) d.moved = true;
        if (d.moved) this.cam.panBy(dx, dy, this.W, this.H);
        d.x = e.clientX;
        d.y = e.clientY;
      });

      on(cv, "pointerup", (e) => {
        const d = this._drag;
        if (d && d.id === e.pointerId) {
          this._drag = null;
          try {
            cv.releasePointerCapture(e.pointerId);
          } catch {
            /* the pointer may already be gone */
          }
          if (d.moved) return; // it was a pan, not a click
        }
        const w = this.cam.toWorld(e.clientX, e.clientY, this.W, this.H);
        if (e.button === 2) this.order(w.x, w.y);
        else this.pick(w.x, w.y);
      });

      on(cv, "pointercancel", () => {
        this._drag = null;
      });

      on(
        cv,
        "wheel",
        (e) => {
          e.preventDefault();
          const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          this.cam.zoomAt(e.clientX, e.clientY, f, this.W, this.H);
        },
        { passive: false },
      );

      on(window, "keydown", (e) => {
        if (ZS.App.state !== "campaign") return;
        const el = document.activeElement;
        /* Never steal a key from a field the player is typing in — the same
           rule the battle learned the hard way (PROGRESS.md, bug 12). */
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
          return;
        }
        if (e.key === "Escape") {
          this.selArmy = null;
          if (ZS.CampaignUI) ZS.CampaignUI.refresh();
        } else if (e.key === "Enter") {
          if (ZS.CampaignUI) ZS.CampaignUI.endTurn();
        } else if (e.key === "c" || e.key === "C") {
          this.focusCapital();
        }
      });
    },

    detach() {
      if (!this._listeners) return;
      for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
      this._listeners = null;
      this._drag = null;
    },

    /* Left click: a stack if one is under the pointer, else the province. */
    pick(wx, wy) {
      const a = this.armyAt(wx, wy);
      if (a && a.faction === this.camp.playerFactionId) {
        this.selectArmy(a.id);
        return;
      }
      const id = ZS.CampaignMap.at(wx, wy);
      if (id) this.selectProvince(id);
    },

    /* Right click: march the selected stack there. */
    order(wx, wy) {
      const id = ZS.CampaignMap.at(wx, wy);
      if (!id) return;
      if (!this.selArmy) {
        this.selectProvince(id);
        return;
      }
      const res = ZS.Turn.march(this.camp, this.selArmy, id);
      if (ZS.CampaignUI) ZS.CampaignUI.notify(res, "campaign.msg.marching", { turns: res.turns });
    },

    /* ---- frame ---------------------------------------------------------- */

    update(dt) {
      this.tt += dt;
    },

    draw(c, t) {
      const camp = this.camp;
      if (!camp || !this.cam) return;
      const map = ZS.CampaignMap;
      const cam = this.cam;

      /* The sheet is rasterized at roughly the zoom it will be shown at, so a
         zoomed-in map is not a blur. Rebuilt only when the zoom band changes,
         never per frame. */
      const band = ZS.clamp(Math.round(cam.zoom * 2) / 2, 0.5, 2);
      if (band !== this._sheetScale) {
        this._sheetScale = band;
        map.invalidateSheet();
      }
      const sheet = map.sheet(band);

      c.save();
      cam.apply(c, this.W, this.H);
      c.lineCap = "round";
      c.lineJoin = "round";

      c.drawImage(sheet, 0, 0, map.size.w, map.size.h);

      const vis = cam.visible(this.W, this.H, 60);
      this.drawOwnership(c, camp, map, vis);
      this.drawSeats(c, camp, map, vis, cam.zoom);
      this.drawBanners(c, camp, map, vis, t);
      this.drawRoute(c, camp, map);
      this.drawArmies(c, camp, map, vis, cam.zoom, t);
      this.drawSelection(c, camp, map);

      c.restore();
    },

    drawOwnership(c, camp, map, vis) {
      for (const p of map.list) {
        if (p.x < vis.x0 - 90 || p.x > vis.x1 + 90 || p.y < vis.y0 - 90 || p.y > vis.y1 + 90) {
          continue;
        }
        const pr = camp.provinces[p.id];
        if (!pr || !pr.owner) continue;
        const fd = camp.factionDef(pr.owner);
        if (!fd) continue;
        const poly = map.poly(p.id);
        if (!poly || poly.length < 3) continue;
        const tint = fd.tint;
        /* Loyalty reads as saturation: a province that hates you is barely
           yours on the map, which is the whole point of showing it. */
        const a = 0.1 + (pr.loyalty / 100) * 0.16;
        ZS.wpoly(c, poly, map.hashId(p.id) * 3.1, 1.6, true);
        c.fillStyle = "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + "," + a.toFixed(3) + ")";
        c.fill();
        if (pr.owner === camp.playerFactionId) {
          c.strokeStyle = "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + ",0.55)";
          c.lineWidth = 1.6;
          c.stroke();
        }
      }
    },

    drawSeats(c, camp, map, vis, zoom) {
      const showName = zoom >= Z_NAME;
      for (const p of map.list) {
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const pr = camp.provinces[p.id];
        const seed = map.hashId(p.id);
        const r = 3 + p.size;

        c.strokeStyle = INK;
        c.lineWidth = 1.4;
        if (pr && pr.dev.wall >= 2) {
          /* A fortress reads as a square keep; a walled city as a ring; an
             open town as a dot. Silhouette is the read, same as the units. */
          ZS.wpoly(
            c,
            [
              { x: p.x - r, y: p.y - r },
              { x: p.x + r, y: p.y - r },
              { x: p.x + r, y: p.y + r },
              { x: p.x - r, y: p.y + r },
            ],
            seed + 4,
            1.1,
            true,
          );
          c.stroke();
        } else if (pr && pr.dev.wall >= 1) {
          ZS.wcirc(c, p.x, p.y, r, seed + 4, 0.9);
          c.stroke();
        } else {
          c.fillStyle = INK;
          c.beginPath();
          c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
          c.fill();
        }

        if (!showName) continue;
        c.fillStyle = INK;
        ZS.boilText(c, ZS.i18n.t(p.name), p.x, p.y - r - 5, 12.5, seed + 21, "center");
        if (zoom >= Z_DETAIL && pr && pr.owner) {
          c.fillStyle = INK_SOFT;
          ZS.boilText(c, ZS.i18n.nc(pr.garrison), p.x, p.y + r + 13, 10.5, seed + 33, "center");
        }
      }
    },

    drawBanners(c, camp, map, vis, t) {
      for (const fd of ZS.data.factions) {
        const f = camp.factions[fd.id];
        if (!f || !f.alive) continue;
        /* The banner flies over the capital while it is still held; a warlord
           driven out of their seat has no banner on the map. */
        if (camp.owner(fd.capital) !== fd.id) continue;
        const p = map.province(fd.capital);
        if (!p || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const flag = ZS.flag.get(fd.flag);
        if (!flag) continue;
        ZS.flag.plant(c, flag, p.x + 13, p.y + 4, 26, t);
      }
    },

    drawArmies(c, camp, map, vis, zoom, t) {
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (a.troops <= 0) continue;
        const p = ZS.Army.position(a, map);
        if (!p || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const fd = camp.factionDef(a.faction);
        if (!fd) continue;
        const seed = map.hashId(a.id);
        const bob = p.moving ? Math.sin(t * 3 + seed) * 1.1 : 0;
        const y = p.y - 11 + bob;
        const tint = fd.tint;

        /* The token is a shield: a wobbly pentagon in the faction tint with an
           ink edge, so it reads against both the paper and the ownership wash
           without needing a legend. */
        const w = 8,
          h = 9;
        ZS.wpoly(
          c,
          [
            { x: p.x - w, y: y - h },
            { x: p.x + w, y: y - h },
            { x: p.x + w, y: y + h * 0.3 },
            { x: p.x, y: y + h },
            { x: p.x - w, y: y + h * 0.3 },
          ],
          seed + 7,
          1.0,
          true,
        );
        c.fillStyle = "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + ",0.55)";
        c.fill();
        c.strokeStyle = INK;
        c.lineWidth = 1.3;
        c.stroke();

        c.fillStyle = "#f3edde";
        ZS.boilText(c, ZS.i18n.t(fd.house), p.x, y + 3.5, 10, seed + 11, "center");

        if (zoom >= Z_NAME) {
          c.fillStyle = INK_SOFT;
          ZS.boilText(c, ZS.i18n.nc(a.troops), p.x, y + h + 11, 10, seed + 17, "center");
        }
      }
    },

    /* The selected stack's remaining route, as a dashed brush line. */
    drawRoute(c, camp, map) {
      const a = this.selArmy ? camp.armies[this.selArmy] : null;
      if (!a || !ZS.Army.isMarching(a)) return;
      const from = ZS.Army.position(a, map);
      if (!from) return;
      c.save();
      c.strokeStyle = "rgba(150,54,44,0.55)";
      c.lineWidth = 1.8;
      c.setLineDash([6, 5]);
      let px = from.x,
        py = from.y;
      for (let i = 0; i < a.path.length; i++) {
        const n = map.province(a.path[i]);
        if (!n) break;
        ZS.wline(c, px, py, n.x, n.y, 300 + i * 7.3, 1.4);
        px = n.x;
        py = n.y;
      }
      c.setLineDash([]);
      ZS.wcirc(c, px, py, 7, 311.7, 1.2);
      c.stroke();
      c.restore();
    },

    drawSelection(c, camp, map) {
      if (this.selProvince) {
        const poly = map.poly(this.selProvince);
        if (poly && poly.length >= 3) {
          c.strokeStyle = INK;
          c.lineWidth = 2;
          ZS.wpoly(c, poly, map.hashId(this.selProvince) * 3.1 + 5, 2.2, true);
          c.stroke();
        }
      }
      const a = this.selArmy ? camp.armies[this.selArmy] : null;
      if (a) {
        const p = ZS.Army.position(a, map);
        if (p) {
          c.strokeStyle = "rgba(150,54,44,0.8)";
          c.lineWidth = 1.8;
          ZS.wcirc(c, p.x, p.y - 11, 15, 407.1, 1.6);
          c.stroke();
        }
      }
    },
  };

  ZS.CampaignView = View;
})();
