/* ZS.CampaignView — the campaign as something you look at and click
   (docs/SANGUO-DESIGN.md §2, §4.1, §7.6).

   The canvas draws the map; every button is DOM (js/ui/campaign.js). Same
   split as the menu and the battle, for the same reasons — focus order,
   keyboard, and a locale switch that refills text for free.

   Layers, back to front:
     1. the sheet      pre-rendered once by js/campaign/map.js — paper, rivers,
                       terrain, roads, borders. Frozen boil: it is a drawn map.
     2. ownership      a faction-tinted wash inside each province polygon
     3. the halo       the player's own ground, glowing while it is their turn
     4. seats          the city glyph and the owner's flag over it
     5. tokens         armies, marching or standing, sized by how many men
     6. orders         routes under way, and the march you are about to give
     7. names          last of all, so nothing is ever drawn across a word

   Layers 2-7 boil with everything else, which is what keeps the map feeling
   like the same hand as the battle.

   **What the map is allowed to say.** The first pass drew everything it knew
   at once — a garrison count under every seat, a troop count over every token,
   a planted banner at every capital, two hills and two trees per province —
   and the result was unreadable: sixty numbers competing with fifty-seven
   names. The rule now is that the map answers *identity* (whose is this, what
   is standing on it, how big is it) always, and *quantity* only for the one
   province or stack the player is pointing at. Size carries what a number
   used to: a stack's token grows with its men, so a threat reads before it is
   counted. Everything else is one hover away.

   **Colour is the legend.** A warlord's `tint` is the province wash, the cloth
   of the flag over every seat they hold, and the fill of their army tokens.
   One colour, one warlord, no key to memorise — which is why the flag is drawn
   in the faction tint rather than the preset's own cloth colour, and why every
   province flies exactly one flag.

   **Input follows the map, not the battlefield.** There is no box-select here,
   so **left-drag pans** and a left *click* picks. Picking is modal in the one
   way a strategy map should be: with none of your stacks held, a click
   selects what you clicked; with one held, the map is a target and a click
   *sends it there*, which is also what dragging the token onto a province
   does. Right-click still marches, for the hand that already knows. Wheel
   zooms. Escape lets go.

   Per-frame allocation: none. The polygons come from CampaignMap and are
   reused, the visible-set scratch arrays are hoisted, and nothing builds a
   record inside draw() (AGENTS.md constraint 5). The march preview is planned
   on the hover *change*, never per frame. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const INK = "#3d342b";
  const INK_SOFT = "rgba(61,52,43,0.5)";
  /* The paper, at the opacity that lets a label sit on top of a saturated
     ownership wash and still be a word rather than a smudge. */
  const PAPER_KNOCK = "rgba(240,233,216,0.78)";
  const RED = "150,54,44";
  const DRAG_SLOP = 5; // px of movement before a click becomes a pan

  /* Zoom thresholds — what is worth drawing at what scale. */
  const Z_NAME = 0.5;

  /* A seat carries three things at once: the flag of whoever holds it, its
     own name, and any stack standing on it. They are stacked deliberately —
     flag above the glyph, name below it, token out to the right — so the three
     never land on each other the way they used to. */
  const TOKEN_DX = 24;
  /* Two stacks in one seat used to be drawn at exactly the same point, which
     made the one underneath unclickable. They fan to the right instead. */
  const FAN_DX = 17;
  const FLAG_W = 17;
  const FLAG_H = 12;

  /* Scratch polygons. draw() runs every frame; these are filled in place and
     handed to ZS.wpoly rather than allocated per token (AGENTS.md 5). */
  const SHIELD = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const KEEP = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  function rgba(tint, a) {
    return "rgba(" + tint[0] + "," + tint[1] + "," + tint[2] + "," + a + ")";
  }

  /* A word on the map, with just enough paper knocked out behind it that the
     wash underneath cannot eat it. */
  function label(c, str, x, y, px, seed, fill) {
    const w = ZS.measureText(c, str, px);
    c.fillStyle = PAPER_KNOCK;
    c.fillRect(x - w / 2 - 2.5, y - px * 0.86, w + 5, px * 1.12);
    c.fillStyle = fill;
    ZS.boilText(c, str, x, y, px, seed, "center");
  }

  const View = {
    ownsLoop: false,
    music: "menu",
    camp: null,
    cam: null,
    W: 0,
    H: 0,
    selProvince: null,
    selArmy: null,
    /* What the pointer is over. The map shows quantities for this and nothing
       else, and the DOM tooltip reads from it. */
    hoverProvince: null,
    hoverArmy: null,
    /* False while a season resolves. The halo is a statement that the board is
       waiting on *you*, so it has to stop being true the moment it isn't. */
    playerTurn: true,
    tt: 0,
    _listeners: null,
    _drag: null,
    _sheetScale: 0,
    _flags: null,
    /* Where each standing stack sits in its province's fan, so two armies in
       one seat are two things you can point at instead of one token with the
       other hidden underneath it. Rebuilt in place once a frame; the Maps are
       cleared, never reallocated. */
    _slot: null,
    _stacked: null,
    /* The march the player is currently aiming, recomputed when the hovered
       province changes rather than per frame: { to, path, turns, err }. */
    _plan: null,
    _cursor: "",
    /* Where the pointer was last seen, so an action can re-read the map under
       it without waiting for the next move. */
    _px: 0,
    _py: 0,

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
      this.hoverProvince = null;
      this.hoverArmy = null;
      this.playerTurn = true;
      this._plan = null;
      this._flags = new Map();
      this._slot = new Map();
      this._stacked = new Map();
      this.tt = 0;
      /* Last, because it is what decides where you are looking and what is
         selected — clearing the selection after it would undo the point. */
      this.focusCapital();
      this.attach();
      if (ZS.CampaignUI) {
        ZS.CampaignUI.onEnter(this);
        if (payload && payload.turnOutcome) ZS.CampaignUI.resumeTurn(payload.turnOutcome);
      }
    },

    exit() {
      this.detach();
      if (ZS.CampaignUI) ZS.CampaignUI.onExit();
      this.camp = null;
      this.cam = null;
      this.selProvince = null;
      this.selArmy = null;
      this.hoverProvince = null;
      this.hoverArmy = null;
      this._plan = null;
      this._flags = null;
      this._slot = null;
      this._stacked = null;
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

    /* The faction's flag, recoloured to the faction's own tint and stripped of
       its tassels — at 17x12 a tassel is a smudge. Cached per faction: this is
       drawn once per held province per frame. */
    factionFlag(fd) {
      if (!fd || !this._flags) return null;
      let f = this._flags.get(fd.id);
      if (f) return f;
      const preset = ZS.flag && ZS.flag.get(fd.flag);
      if (!preset) return null;
      f = {
        seed: ZS.CampaignMap.hashId(fd.id),
        text: preset.text,
        chrome: Object.assign({}, preset.chrome, { color: fd.tint, tassels: 0 }),
      };
      this._flags.set(fd.id, f);
      return f;
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
      this.replan();
      if (ZS.CampaignUI) ZS.CampaignUI.refresh();
    },

    /* The stack the player is currently commanding, or null. Every "is the map
       a target right now" question funnels through this one answer. */
    heldArmy() {
      if (!this.selArmy || !this.camp) return null;
      const a = this.camp.armies[this.selArmy];
      return a && a.faction === this.camp.playerFactionId ? a : null;
    },

    /* Plan the march the player is aiming, so the map can draw the route and
       the tooltip can name the cost before the order is given. Called on a
       hover change, never per frame. */
    replan() {
      const a = this.heldArmy();
      const to = this.hoverProvince;
      if (!a || !to || !ZS.Turn.marchPlan) {
        this._plan = null;
        return;
      }
      if (this._plan && this._plan.to === to && this._plan.army === a.id) return;
      const res = ZS.Turn.marchPlan(this.camp, a.id, to);
      this._plan = {
        army: a.id,
        to,
        path: res.ok ? res.path : null,
        turns: res.ok ? res.turns : 0,
        err: res.ok ? null : res.err,
      };
    },

    /* One pass over the stacks, before anything is drawn or hit-tested: every
       army standing in a province gets its place in that province's row. A
       marching stack is on the road and needs no place. */
    layoutStacks() {
      const camp = this.camp;
      if (!camp || !this._slot) return;
      this._slot.clear();
      this._stacked.clear();
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (a.troops <= 0 || ZS.Army.isMarching(a)) continue;
        const n = this._stacked.get(a.at) || 0;
        this._stacked.set(a.at, n + 1);
        this._slot.set(a.id, n);
      }
    },

    /* How far right of its seat a standing stack's token is drawn. A stack
       raised this instant has no place yet — an order can land between two
       frames — so an unknown id relays the row rather than answering 0 and
       putting the new token underneath an old one. */
    tokenDX(a) {
      if (!this._slot) return TOKEN_DX;
      if (!this._slot.has(a.id)) this.layoutStacks();
      return TOKEN_DX + (this._slot.get(a.id) || 0) * FAN_DX;
    },

    /* The player's own stack nearest a world point, within a token's reach. */
    armyAt(wx, wy) {
      const camp = this.camp;
      /* Hit-test where the tokens are *now*, not where the last frame put
         them: a pointer event can arrive before the next draw. */
      this.layoutStacks();
      let best = null,
        bd = 24 * 24;
      for (const id in camp.armies) {
        const a = camp.armies[id];
        const p = ZS.Army.position(a, ZS.CampaignMap);
        if (!p) continue;
        /* Hit-test where the token is *drawn*, not where the stack nominally
           is, or a standing stack is unclickable by exactly its own offset. */
        const tx = p.x + (p.moving ? 0 : this.tokenDX(a));
        const ty = p.y - 11;
        const d = (tx - wx) * (tx - wx) + (ty - wy) * (ty - wy);
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
        const w = this.cam.toWorld(e.clientX, e.clientY, this.W, this.H);
        const a = this.armyAt(w.x, w.y);
        const own = a && a.faction === this.camp.playerFactionId ? a : null;
        /* Pressing on one of your own stacks arms the gesture without
           committing to it. It can still end two ways — let go where you
           started and it was a click (which selects, or deselects the stack
           already in hand), or drag to a province and let go, which is the
           march. Selecting here would make the click path toggle a selection
           it had just made, so the selection waits for the first move. Either
           way this branch does not pan. */
        this._drag = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          x0: e.clientX,
          y0: e.clientY,
          moved: false,
          button: e.button,
          army: own ? own.id : null,
        };
        cv.setPointerCapture(e.pointerId);
        this.updateHover(e.clientX, e.clientY);
      });

      on(cv, "pointermove", (e) => {
        const d = this._drag;
        this.updateHover(e.clientX, e.clientY);
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_SLOP) {
          d.moved = true;
          /* The moment it is a drag rather than a click, the stack really is
             in hand — which is what puts the route preview under the cursor
             for the rest of the gesture. */
          if (d.army) this.selectArmy(d.army);
        }
        /* Dragging a stack aims it; dragging the paper moves the paper. */
        if (d.moved && !d.army) this.cam.panBy(dx, dy, this.W, this.H);
        d.x = e.clientX;
        d.y = e.clientY;
      });

      on(cv, "pointerup", (e) => {
        const d = this._drag;
        let dragged = false,
          dragArmy = null;
        if (d && d.id === e.pointerId) {
          this._drag = null;
          try {
            cv.releasePointerCapture(e.pointerId);
          } catch {
            /* the pointer may already be gone */
          }
          dragged = d.moved;
          dragArmy = d.army;
          if (dragged && !dragArmy) return; // it was a pan, not a click
        }
        const w = this.cam.toWorld(e.clientX, e.clientY, this.W, this.H);
        this.updateHover(e.clientX, e.clientY);
        if (e.button === 2) this.order(w.x, w.y);
        else if (dragged && dragArmy) this.release(w.x, w.y, dragArmy);
        else this.pick(w.x, w.y);
        /* The click just changed what the map means under a pointer that has
           not moved: the cursor, the route preview and the tooltip are all
           answers to "what happens if I click here", and all three are now
           stale. Ask again rather than waiting for the next mousemove. */
        this.updateHover(e.clientX, e.clientY);
      });

      on(cv, "pointercancel", () => {
        this._drag = null;
      });

      on(cv, "pointerleave", () => {
        this.hoverProvince = null;
        this.hoverArmy = null;
        this._plan = null;
        if (ZS.CampaignUI) ZS.CampaignUI.hideTip();
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
          this._plan = null;
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
      if (ZS.App.cv) ZS.App.cv.style.cursor = "";
      this._cursor = "";
    },

    /* What is under the pointer, and what the pointer should look like because
       of it. The tooltip is DOM (js/ui/campaign.js) — the map draws the world,
       the overlay does the reading. */
    updateHover(cx, cy) {
      if (!this.cam || !this.camp) return;
      this._px = cx;
      this._py = cy;
      const w = this.cam.toWorld(cx, cy, this.W, this.H);
      const a = this.armyAt(w.x, w.y);
      const id = ZS.CampaignMap.at(w.x, w.y);
      const changed = id !== this.hoverProvince || (a ? a.id : null) !== this.hoverArmy;
      this.hoverProvince = id;
      this.hoverArmy = a ? a.id : null;
      if (changed) this.replan();

      const held = this.heldArmy();
      const cur =
        this._drag && this._drag.moved && !this._drag.army
          ? "grabbing"
          : held
            ? "crosshair"
            : a || id
              ? "pointer"
              : "default";
      if (cur !== this._cursor && ZS.App.cv) {
        ZS.App.cv.style.cursor = cur;
        this._cursor = cur;
      }
      if (ZS.CampaignUI) ZS.CampaignUI.showTip(cx, cy, changed);
    },

    /* Left click. With a stack in hand the map is a target; without one it is
       a board you are reading. */
    pick(wx, wy) {
      const a = this.armyAt(wx, wy);
      if (a && a.faction === this.camp.playerFactionId) {
        /* Clicking the stack you are already holding puts it back down — the
           way out of target mode that does not need the keyboard. */
        if (a.id === this.selArmy) {
          this.selArmy = null;
          this._plan = null;
          if (ZS.CampaignUI) ZS.CampaignUI.refresh();
        } else {
          this.selectArmy(a.id);
        }
        return;
      }
      const id = ZS.CampaignMap.at(wx, wy);
      if (!id) return;
      const held = this.heldArmy();
      if (held && id !== held.at) {
        this.order(wx, wy);
        /* The order is given, so the stack goes back down: the next click is
           free to read the board again instead of re-marching. */
        this.selArmy = null;
        this._plan = null;
        if (ZS.CampaignUI) ZS.CampaignUI.refresh();
        return;
      }
      this.selectProvince(id);
    },

    /* Letting go of a dragged stack over a province is the same order as
       clicking one — the gesture, not the verb, is what differs. The stack
       comes from the gesture rather than from the selection, so a drag that
       started before anything was selected still gives the order. */
    release(wx, wy, armyId) {
      const a = this.camp.armies[armyId];
      const id = ZS.CampaignMap.at(wx, wy);
      if (!a || !id || id === a.at) {
        /* Dropped on its own ground, or on nothing: the drag was a change of
           mind, and the stack is simply left in hand. */
        return;
      }
      this.selArmy = armyId;
      this.order(wx, wy);
      this.selArmy = null;
      this._plan = null;
      if (ZS.CampaignUI) ZS.CampaignUI.refresh();
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
      this._plan = null;
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
      this.layoutStacks();
      this.drawOwnership(c, camp, map, vis);
      this.drawHalo(c, camp, map, vis, t);
      this.drawFocus(c, camp, map);
      this.drawRoutes(c, camp, map);
      this.drawSeats(c, camp, map, vis, t);
      this.drawArmies(c, camp, map, vis, t);
      this.drawPlan(c, camp, map);
      this.drawLabels(c, camp, map, vis, cam.zoom);

      c.restore();
    },

    /* Pass one: the flat wash. Every held province in its warlord's colour,
       at one opacity, so the colour answers "whose" and nothing else. */
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
        /* Loyalty still reads as saturation, but over a much narrower band
           than it used to: a hated province should look thin, not look like a
           different warlord's. Hue is the identity and never moves. */
        const a = 0.2 + (pr.loyalty / 100) * 0.13;
        ZS.wpoly(c, poly, map.hashId(p.id) * 3.1, 1.6, true);
        c.fillStyle = rgba(fd.tint, a.toFixed(3));
        c.fill();
        if (pr.owner !== camp.playerFactionId) {
          c.strokeStyle = rgba(fd.tint, 0.42);
          c.lineWidth = 1.1;
          c.stroke();
        }
      }
    },

    /* Pass two, after every wash is down so no neighbour can paint over it:
       the player's own ground, ringed by a soft glow in their own colour. The
       question "which of these is mine" should not survive one glance, and
       while the season is waiting on the player the glow breathes — when the
       season is resolving it holds still, because then the board is not. */
    drawHalo(c, camp, map, vis, t) {
      const fd = camp.factionDef(camp.playerFactionId);
      if (!fd) return;
      const tint = fd.tint;
      const pulse = this.playerTurn ? 0.5 + 0.5 * Math.sin(t * 2.1) : 0;
      for (const id of camp.provincesOf(camp.playerFactionId)) {
        const p = map.province(id);
        if (!p) continue;
        if (p.x < vis.x0 - 90 || p.x > vis.x1 + 90 || p.y < vis.y0 - 90 || p.y > vis.y1 + 90) {
          continue;
        }
        const poly = map.poly(id);
        if (!poly || poly.length < 3) continue;
        ZS.wpoly(c, poly, map.hashId(id) * 3.1, 1.6, true);
        c.strokeStyle = rgba(tint, (0.07 + 0.07 * pulse).toFixed(3));
        c.lineWidth = 12;
        c.stroke();
        c.strokeStyle = rgba(tint, (0.16 + 0.14 * pulse).toFixed(3));
        c.lineWidth = 5.5;
        c.stroke();
        c.strokeStyle = rgba(tint, 0.9);
        c.lineWidth = 2;
        c.stroke();
      }
    },

    /* The province the player has selected, and the one under the pointer.
       Ink, not colour — this is "where you are", not "whose it is". */
    drawFocus(c, camp, map) {
      const hov = this.hoverProvince;
      if (hov && hov !== this.selProvince) {
        const poly = map.poly(hov);
        if (poly && poly.length >= 3) {
          ZS.wpoly(c, poly, map.hashId(hov) * 3.1 + 9, 1.9, true);
          c.fillStyle = "rgba(61,52,43,0.05)";
          c.fill();
          c.strokeStyle = INK_SOFT;
          c.lineWidth = 1.4;
          c.stroke();
        }
      }
      if (this.selProvince) {
        const poly = map.poly(this.selProvince);
        if (poly && poly.length >= 3) {
          ZS.wpoly(c, poly, map.hashId(this.selProvince) * 3.1 + 5, 2.2, true);
          c.strokeStyle = INK;
          c.lineWidth = 2.4;
          c.stroke();
        }
      }
    },

    /* The city glyph and the flag over it. Names are NOT drawn here — they go
       in a pass of their own, after the tokens, because a province whose seat
       happens to sit a few pixels earlier in the list was having its name
       painted over by its neighbour's banner. A label always wins. */
    drawSeats(c, camp, map, vis, t) {
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
          KEEP[0].x = p.x - r;
          KEEP[0].y = p.y - r;
          KEEP[1].x = p.x + r;
          KEEP[1].y = p.y - r;
          KEEP[2].x = p.x + r;
          KEEP[2].y = p.y + r;
          KEEP[3].x = p.x - r;
          KEEP[3].y = p.y + r;
          ZS.wpoly(c, KEEP, seed + 4, 1.1, true);
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

        /* The one flag. Whoever holds this province flies over its seat, in
           their own colour, and nobody else's banner is anywhere near it —
           which is the whole of the map's legend. A warlord's capital carries
           the same flag on a planted pole, so a seat of power reads as one
           without being a second, competing marker. */
        const fd = pr && pr.owner ? camp.factionDef(pr.owner) : null;
        const flag = fd ? this.factionFlag(fd) : null;
        if (flag) {
          /* Rooted in the seat, not floating over it: the pole starts just
             above the city glyph, so the flag and the city read as one thing
             rather than a stamp on a stick. */
          const seat = fd.capital === p.id;
          const px = p.x - 8;
          const fy = p.y - r - 4 - FLAG_H;
          c.strokeStyle = "rgba(110,80,50,0.8)";
          c.lineWidth = seat ? 2.1 : 1.3;
          ZS.wline(c, px, p.y - r * 0.4, px, fy - 1.5, seed + 6, 0.35);
          c.fillStyle = INK;
          c.beginPath();
          c.arc(px, fy - 2, seat ? 2.1 : 1.4, 0, Math.PI * 2);
          c.fill();
          ZS.flag.draw(c, flag, px + 1, fy, FLAG_W, FLAG_H, t);
        }
      }
    },

    /* The last pass over the map, so nothing can land on a word: the province
       names, and — for the one province being looked at, and only that one —
       its garrison. Sixty garrison counts at once is what made the first map
       unreadable; one, under the pointer, is what the player actually asked. */
    drawLabels(c, camp, map, vis, zoom) {
      if (zoom < Z_NAME) return;
      for (const p of map.list) {
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const seed = map.hashId(p.id);
        const r = 3 + p.size;
        /* Below the seat, because the flag has the space above it. */
        label(c, ZS.i18n.t(p.name), p.x, p.y + r + 14, 12.5, seed + 21, INK);
        const pr = camp.provinces[p.id];
        if (pr && pr.owner && (p.id === this.selProvince || p.id === this.hoverProvince)) {
          label(c, ZS.i18n.nc(pr.garrison), p.x, p.y + r + 28, 10.5, seed + 33, INK_SOFT);
        }
      }
    },

    drawArmies(c, camp, map, vis, t) {
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (a.troops <= 0) continue;
        const p = ZS.Army.position(a, map);
        if (!p || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        const fd = camp.factionDef(a.faction);
        if (!fd) continue;
        const seed = map.hashId(a.id);
        const bob = p.moving ? Math.sin(t * 3 + seed) * 1.1 : 0;
        /* A stack on the road is drawn on the road; a stack standing in a
           province steps to the right of the seat glyph so both stay legible. */
        const x = p.moving ? p.x : p.x + this.tokenDX(a);
        const y = p.y - 11 + bob;
        const tint = fd.tint;
        const focused = a.id === this.selArmy || a.id === this.hoverArmy;

        /* The token is a shield in the faction tint with an ink edge, so it
           reads against both the paper and the ownership wash without needing
           a legend — and it *grows with its men*. Two hundred spears and four
           thousand used to be the same shape with a different caption; now the
           size is the caption, and the exact count is one hover away. */
        const w = 5 + ZS.clamp(Math.log2(Math.max(200, a.troops) / 200) * 1.25, 0, 5.5);
        const h = w * 1.12;
        SHIELD[0].x = x - w;
        SHIELD[0].y = y - h;
        SHIELD[1].x = x + w;
        SHIELD[1].y = y - h;
        SHIELD[2].x = x + w;
        SHIELD[2].y = y + h * 0.3;
        SHIELD[3].x = x;
        SHIELD[3].y = y + h;
        SHIELD[4].x = x - w;
        SHIELD[4].y = y + h * 0.3;
        ZS.wpoly(c, SHIELD, seed + 7, 1.0, true);
        c.fillStyle = rgba(tint, 0.85);
        c.fill();
        c.strokeStyle = focused ? "rgba(" + RED + ",0.95)" : INK;
        c.lineWidth = focused ? 2.2 : 1.3;
        c.stroke();

        c.fillStyle = "#f3edde";
        ZS.boilText(c, ZS.i18n.t(fd.house), x, y + h * 0.42, w * 1.25, seed + 11, "center");

        if (focused) {
          label(c, ZS.i18n.nc(a.troops), x, y - h - 5, 11, seed + 17, INK);
        }
      }
    },

    /* Every march the player has under way, so a season's worth of orders is
       one look rather than one selection each. */
    drawRoutes(c, camp, map) {
      c.save();
      c.setLineDash([6, 5]);
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (a.faction !== camp.playerFactionId || !ZS.Army.isMarching(a)) continue;
        const from = ZS.Army.position(a, map);
        if (!from) continue;
        const lead = a.id === this.selArmy;
        c.strokeStyle = "rgba(" + RED + "," + (lead ? 0.7 : 0.3) + ")";
        c.lineWidth = lead ? 2 : 1.4;
        let px = from.x,
          py = from.y;
        for (let i = 0; i < a.path.length; i++) {
          const n = map.province(a.path[i]);
          if (!n) break;
          ZS.wline(c, px, py, n.x, n.y, 300 + i * 7.3, 1.4);
          px = n.x;
          py = n.y;
        }
        ZS.wcirc(c, px, py, 6, 311.7, 1.2);
      }
      c.setLineDash([]);
      c.restore();
    },

    /* The order you have not given yet: the route from the stack in your hand
       to whatever the pointer is over, and a reticle on the province it would
       take. Refused marches draw nothing — the tooltip says why. */
    drawPlan(c, camp, map) {
      const plan = this._plan;
      const a = this.heldArmy();
      if (!plan || !a || !plan.path) return;
      const from = ZS.Army.position(a, map);
      if (!from) return;
      c.save();
      c.strokeStyle = "rgba(" + RED + ",0.85)";
      c.lineWidth = 2.2;
      c.setLineDash([7, 4]);
      let px = from.x,
        py = from.y;
      for (let i = 1; i < plan.path.length; i++) {
        const n = map.province(plan.path[i]);
        if (!n) break;
        ZS.wline(c, px, py, n.x, n.y, 620 + i * 5.1, 1.5);
        px = n.x;
        py = n.y;
      }
      c.setLineDash([]);
      /* A reticle, not a dot: this is the one place on the map the player is
         being asked to aim at something. */
      c.lineWidth = 2;
      ZS.wcirc(c, px, py, 13, 640.3, 1.4);
      ZS.wline(c, px - 19, py, px - 15, py, 641.1, 0.5);
      ZS.wline(c, px + 15, py, px + 19, py, 642.1, 0.5);
      ZS.wline(c, px, py - 19, px, py - 15, 643.1, 0.5);
      ZS.wline(c, px, py + 15, px, py + 19, 644.1, 0.5);
      c.restore();
    },
  };

  ZS.CampaignView = View;
})();
