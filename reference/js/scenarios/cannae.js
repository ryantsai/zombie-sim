/* SCENARIO PACK: Cannae, 216 BC — the double envelopment
 *
 * Everything scenario-specific lives here: who the agents are, how they
 * look, move, fight, break, and how the battle plays out. The core engine
 * (js/*.js) knows nothing about the Punic war — it runs the clock,
 * physics, spacing, navigation, camera, and rendering pipeline, and calls
 * this pack for the parts a scenario decides. See
 * reference/js/scenarios/zombie.js
 * for the contract; this pack implements the same surface:
 *
 *   attachStains(st)                        register splat/corpse painters
 *   makeAgent(x, y, st, extra)              agent record (core fields + yours)
 *   hostile(a)                              true -> AI runs first (A* budget)
 *   walkBlocked(a)                          true -> interiors/doors are solid
 *   maxSpeed(a)                              per-agent speed cap
 *   frame(agents, dt, t, grid)              once per frame, before the AI pass
 *   update(a, dt, t, grid, nav, world, buildings, wave)   per-agent AI
 *   init(agents, world, vw, vh, wave)       start a battle
 *   maintain(agents, dt, world, vw, vh)     between rounds (no-op: no reserves)
 *   left(agents)                            0 -> the battle is decided
 *   counts(agents)                           stats for the HUD
 *   tap(agents, world, x, y)                 rally the nearest line
 *   hud(agents, wave)                        { title, stats, hint, legend, overlay() }
 *   draw(c, a, t)                            one agent, all of it
 *   drawFX(c, fx)                            transient effect records
 *
 * The battle is unit-driven: every agent holds a slot in a formation whose
 * centroid is driven by a per-unit step script (hold, advance, fold back,
 * charge, peel off). Combat is local — nearest enemy in reach — so the
 * famous Cannae shape (roman center bulges, carthaginian salient yields
 * and folds into a crescent, Hasdrubal's heavy cavalry sweeps the south
 * wing to the roman rear, Numidians sweep the north to the roman rear, and the
 * legions rout) emerges from the scripts plus separation and morale, not
 * from per-agent choreography. The battle ends only when one side is fully
 * dead or off the field.
 * The battlefield is scenario-built (terrain()): the Aufidus runs along
 * the carthaginian rear, the romans stand east and the carthaginians west,
 * the lines face each other across open plain, and there is no town.
 *
 * Core-owned agent fields: x y vx vy a st seed gait id wantMove dead
 * path pi gx gy navV0 planFailT stuckT wx wt px py bld, plus the
 * presentation lifetimes flash and sayT (decayed by the core). A speech
 * bubble shows while a.say is set and a.sayT > 0 (a.sayMax = total time).
 * Transient effects are pushed onto this.fx as records carrying t (the
 * core decays and prunes them): clash { x, y, t, clash, seed }, sling
 * { x0, y0, x1, y1, t, sling, seed }, rally { x, y, t, rally, seed },
 * poof { x, y, t, poof, seed }, blood { x, y, t, blood, seed }.
 */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const ROME = 0,
    CAR = 1;
  const HEAVY = 0,
    SLINGER = 1,
    CAV = 2,
    LCAV = 3;
  // unit states
  const HOLD = 0,
    ADV = 1,
    RET = 2,
    CHARGE = 3,
    DIS = 4,
    SKIRM = 5,
    ROUT = 6;

  /* ---------- combat knobs ---------- */

  const ENG = 19; // melee reach
  const ATK_CD = 0.75; // seconds between spear swings
  const SLNG_R = 190; // sling range
  const SLNG_CD = 2.4; // seconds between throws
  const SLNG_IN = 155; // slinger backs off inside this
  const SLNG_OUT = 175; // ...and presses out to this
  const MOR_R = 56; // morale neighborhood
  const UNIT_BREAK = [0.45, 0.55]; // alive-fraction that breaks a unit, per side
  const SAY_MAX = 36; // cap on bubbles on the page at once

  const EXIT_PAD = 30; // off-field margin that counts as fled
  const HUNT_FRAC = 0.6; // enemy dead+routed fraction that triggers pursuit
  const HUNT_R = 900; // hunt scan radius
  const HUNT_CD = 0.7; // hunt retarget interval

  const HP = [3, 1, 2, 1]; // roman: heavy / slinger / heavy cav / Numidian
  const CAR_HP = [4, 1, 4, 2]; // carthaginian (African veterans and heavy cav are sturdier)
  const FLEE_SP = [112, 122, 140, 150];
  // unit drive speed per role and state: [HOLD, ADV, RET, CHARGE, DIS, SKIRM, ROUT, RALLY]
  const UNIT_SPD = [
    [0, 40, 46, 172, 112, 34, 0, 90],
    [0, 40, 40, 0, 110, 34, 0, 90],
    [0, 100, 0, 172, 112, 0, 0, 95],
    [0, 105, 0, 150, 118, 0, 0, 95],
  ];

  const ROM_PHRASES = ["ei, ei!", "hold the center!", "for rome!", "to the wings!"];
  const CAR_PHRASES = ["for carthage!", "no retreat!", "break their line!", "hanibal!"];

  /* ---------- inks ---------- */

  const INK = "rgb(61,52,43)";
  const ROM_SHIELD = "rgba(146,52,38,0.38)";
  const CAR_SHIELD = "rgba(74,96,134,0.38)";
  const ROM_FLAG = "rgba(146,52,38,0.6)";
  const CAR_FLAG = "rgba(74,96,134,0.6)";
  const SPECKLE = "rgba(92,30,26,";
  const BLOTCH = "rgba(122,42,36,";
  const POOL = "rgba(112,38,32,0.28)";

  const SP = 13; // slot spacing inside a formation
  const TG = { x: 0, y: 0 }; // scratch target (no per-frame allocation)

  /* ---------- units, in order of creation ---------- */

  const U_R_CTR_N = 0,
    U_R_CTR_S = 1,
    U_R_CAV_N = 2,
    U_R_CAV_S = 3,
    U_C_CTR_N = 4,
    U_C_CTR_S = 5,
    U_C_CAV = 6,
    U_NUMID = 7,
    U_SLNG = 8,
    U_SLNG_S = 9;

  class ScenarioCannae {
    constructor() {
      this.fx = null; // set by main: the core's effect record array
      this.stains = null; // set by main via attachStains
      this.units = [];
      this.sides = [];
      this.t0 = null;
      this.bt = 0;
      this.result = 0; // winner's side once over: 0 rome, 1 carthage
      this.over = false;
      this.sepR = 13; // ranks sit at slot spacing: keep them from inflating
      this.talkingNow = 0;
      this.trigger1 = false;
      this.trigger2 = false;
      this.anchorT = 0;
      this.w = 0;
      this.h = 0;
      this.field = null;
    }

    /* ---------- persistent damage painters ---------- */

    attachStains(st) {
      this.stains = st;
      st.register("cut", (sc, x, y, seed) => {
        const rot = ZS.hash(seed) * Math.PI * 2;
        const len = 7 + ZS.hash(seed + 1) * 6;
        sc.strokeStyle = BLOTCH + (0.35 + ZS.hash(seed + 2) * 0.2) + ")";
        sc.lineWidth = 2.5;
        ZS.wline(
          sc,
          x - Math.cos(rot) * len * 0.5,
          y - Math.sin(rot) * len * 0.5,
          x + Math.cos(rot) * len * 0.5,
          y + Math.sin(rot) * len * 0.5,
          seed,
          1.2,
        );
        const n = 3 + ((ZS.hash(seed + 3) * 3) | 0);
        for (let i = 0; i < n; i++) {
          const an = ZS.hash(seed + 10 + i) * 6.283;
          const d = ZS.hash(seed + 20 + i) * 10;
          st.fillBlob(
            x + Math.cos(an) * d,
            y + Math.sin(an) * d,
            0.7 + ZS.hash(seed + 30 + i) * 1.3,
            seed + 40 + i,
            SPECKLE + (0.4 + ZS.hash(seed + 30 + i) * 0.2) + ")",
          );
        }
      });
      st.register("corpse", (sc, a) => {
        const seed = a.seed;
        const rot = ZS.hash(seed) * 6.283;
        // blood pool
        const pts = [];
        const nPts = 7 + ((ZS.hash(seed + 1) * 3) | 0);
        const radius = 12 + ZS.hash(seed + 2) * 5;
        for (let i = 0; i < nPts; i++) {
          const an = (i / nPts) * 6.283 + rot;
          const rr = radius * (0.8 + ZS.hash(seed + 10 + i) * 0.4);
          pts.push({
            x: a.x + Math.cos(an) * rr * 1.25,
            y: a.y + Math.sin(an) * rr * 0.8,
          });
        }
        sc.fillStyle = POOL;
        ZS.wpoly(sc, pts, seed + 20, 2, true);
        sc.fill();
        // body lying down
        sc.strokeStyle = "rgb(70,58,48)";
        sc.lineWidth = 2;
        const hx = a.x + Math.cos(rot) * 13;
        const hy = a.y + Math.sin(rot) * 13;
        const tx = a.x - Math.cos(rot) * 12;
        const ty = a.y - Math.sin(rot) * 12;
        ZS.wline(sc, hx, hy, tx, ty, seed + 100, 1.5);
        ZS.wcirc(sc, hx, hy, 4.2, seed + 101, 0.7);
        ZS.wline(
          sc,
          hx,
          hy,
          hx + Math.cos(rot + 1.4) * 9,
          hy + Math.sin(rot + 1.4) * 9,
          seed + 102,
          1.2,
        );
        ZS.wline(
          sc,
          hx,
          hy,
          hx + Math.cos(rot - 1.4) * 9,
          hy + Math.sin(rot - 1.4) * 9,
          seed + 103,
          1.2,
        );
        ZS.wline(
          sc,
          tx,
          ty,
          tx + Math.cos(rot + 2.5) * 10,
          ty + Math.sin(rot + 2.5) * 10,
          seed + 104,
          1.2,
        );
        ZS.wline(
          sc,
          tx,
          ty,
          tx + Math.cos(rot - 2.5) * 10,
          ty + Math.sin(rot - 2.5) * 10,
          seed + 105,
          1.2,
        );
        // shield dropped nearby
        if (a.role === HEAVY || a.role === CAV) {
          const sx = a.x + Math.cos(rot + 1.9) * 16;
          const sy = a.y + Math.sin(rot + 1.9) * 16;
          if (a.side === ROME) {
            sc.fillStyle = "rgba(146,52,38,0.30)";
            sc.strokeStyle = "rgb(96,52,42)";
            sc.lineWidth = 1.3;
            ZS.wpoly(
              sc,
              [
                { x: sx - 4, y: sy - 6 },
                { x: sx + 4, y: sy - 6 },
                { x: sx + 4, y: sy + 6 },
                { x: sx - 4, y: sy + 6 },
              ],
              seed + 110,
              0.8,
              true,
            );
            sc.fill();
            sc.stroke();
          } else {
            sc.fillStyle = "rgba(74,96,134,0.30)";
            sc.strokeStyle = "rgb(70,80,110)";
            sc.lineWidth = 1.3;
            ZS.wcirc(sc, sx, sy, 5.5, seed + 110, 0.8);
            sc.fill();
            sc.stroke();
          }
        }
        // a spear left on the ground
        if (a.role === HEAVY) {
          const wa = rot + 1.2 + (ZS.hash(seed + 4) - 0.5);
          sc.strokeStyle = "rgb(96,80,58)";
          sc.lineWidth = 1.4;
          ZS.wline(
            sc,
            a.x + Math.cos(wa) * 6,
            a.y + Math.sin(wa) * 6,
            a.x + Math.cos(wa) * 26,
            a.y + Math.sin(wa) * 26,
            seed + 115,
            0.8,
          );
        }
      });
    }

    /* ---------- agents ---------- */

    makeAgent(x, y, st, extra) {
      return {
        x,
        y,
        a: 0,
        vx: 0,
        vy: 0,
        st,
        seed: Math.random() * 997,
        gait: 0,
        id: 0,
        wantMove: false,
        dead: false,
        // navigation state
        path: null,
        pi: 0,
        gx: null,
        gy: null,
        navV0: 0,
        planFailT: 0,
        stuckT: 0,
        wx: null,
        wt: 0,
        bld: -1,
        px: 0,
        py: 0,
        // presentation lifetimes (core decays these)
        flash: 0,
        say: null,
        sayT: 0,
        sayMax: 0,
        sayCd: ZS.rnd(0, 10),
        // cannae fields
        side: extra.side,
        role: extra.role,
        un: extra.un,
        sx: extra.sx,
        sy: extra.sy, // slot offsets, unit-local (x = right, y = forward)
        sx2: 0,
        sy2: 0, // slot world position (scratch)
        hp: extra.hp,
        atkCd: ZS.rnd(0, 0.4),
        atk: 0, // melee swing animation
        thrCd: ZS.rnd(0, 0.6),
        thr: 0, // sling throw animation
        hitCd: 0, // cavalry collision cooldown
        routFlag: 0,
        fleeing: false,
        rallyT: 0,
        morT: ZS.rnd(0, 0.5),
        fdirC: -999, // committed flight direction (-999 = not yet aimed)
        fdir: 0,
        leader: !!extra.leader,
      };
    }

    hostile(_a) {
      return false; // open field: nobody needs A* budget priority
    }

    walkBlocked(_a) {
      return true; // open field: nothing blocks
    }

    maxSpeed(a) {
      if (a.fleeing) return FLEE_SP[a.role];
      const u = this.units[a.un];
      if (u.st === CHARGE) return a.role === LCAV ? 152 : 176;
      switch (a.role) {
        case HEAVY:
          return 64;
        case SLINGER:
          return 95;
        case CAV:
          return 120;
        default:
          return 126;
      }
    }

    /* ---------- frame ---------- */

    frame(agents, dt, t, grid) {
      if (this.t0 === null) this.t0 = t;
      const bt = (this.bt = t - this.t0);

      // routed men who leave the field count as gone, not coming back
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (
          a.free &&
          !a.dead &&
          !a.gone &&
          (a.x < -EXIT_PAD || a.x > this.w + EXIT_PAD || a.y < -EXIT_PAD || a.y > this.h + EXIT_PAD)
        ) {
          a.gone = true;
          this.sides[a.side].gone++;
        }
      }

      this.talkingNow = 0;
      for (let i = 0; i < agents.length; i++) if (agents[i].sayT > 0) this.talkingNow++;

      // unit centroids are the mean of their members
      for (const u of this.units) {
        let sx = 0,
          sy = 0,
          n = 0;
        for (let i = 0; i < u.mem.length; i++) {
          const m = u.mem[i];
          if (m.dead) continue;
          sx += m.x;
          sy += m.y;
          n++;
        }
        if (n) {
          u.cx = sx / n;
          u.cy = sy / n;
        }
        u.alive = n;
      }

      // the slinger screens hold in front of each carthaginian center: a
      // midpoint that follows the roman approach and the carthaginian fold,
      // clamped to stay well in front of their own front rank
      this.anchorT -= dt;
      if (this.anchorT <= 0) {
        this.anchorT = 0.5;
        const pairs = [
          [U_SLNG, U_C_CTR_N, U_R_CTR_N],
          [U_SLNG_S, U_C_CTR_S, U_R_CTR_S],
        ];
        for (const [si, ci, ri] of pairs) {
          const su = this.units[si],
            cu = this.units[ci],
            ru = this.units[ri];
          const carx = cu.cx,
            romx = ru.cx;
          const tx = carx + (romx - carx) * 0.5;
          su.tx = Math.max(carx + 90, Math.min(carx + 240, tx));
          su.ty = cu.cy;
        }
      }

      // the carthaginian center folds the moment the legions' spears touch
      // its front rank: distance to the nearest roman, not the centroid, so
      // front-rank attrition can't pull the trigger back
      if (!this.trigger1) {
        const u = this.units[U_C_CTR_N];
        let d2 = 58 * 58;
        grid.query(u.cx, u.cy, 90, (b) => {
          if (b.side !== ROME || b.dead) return;
          const dx = b.x - u.cx,
            dy = b.y - u.cy;
          const dd = dx * dx + dy * dy;
          if (dd < d2) d2 = dd;
        });
        if (d2 < 58 * 58) {
          this.trigger1 = true;
          this._advance(agents, this.units[U_C_CTR_N]);
          this._advance(agents, this.units[U_C_CTR_S]);
        }
      }

      // the legions press: the roman center's goal is the carthaginian
      // line itself, so the bulge follows the fold into the pocket
      if (this.trigger1 && !this.trigger2) {
        const cxc = (this.units[U_C_CTR_N].cx + this.units[U_C_CTR_S].cx) / 2;
        const cxr = (this.units[U_R_CTR_N].cx + this.units[U_R_CTR_S].cx) / 2;
        if (cxr < cxc - 40) {
          // the roman center has crossed into the pocket: close the crescent
          this.trigger2 = true;
          this._advance(agents, this.units[U_C_CTR_N]);
          this._advance(agents, this.units[U_C_CTR_S]);
        }
      }

      this.pressT -= dt;
      if (this.pressT <= 0 && !this.over) {
        this.pressT = 0.5;
        const tgt = (this.units[U_C_CTR_N].cx + this.units[U_C_CTR_S].cx) / 2 + 42;
        const rn = this.units[U_R_CTR_N],
          rs = this.units[U_R_CTR_S];
        if (rn.st === ADV) rn.tx = tgt;
        if (rs.st === ADV) rs.tx = tgt;
      }

      // formations wheel toward their step's heading
      for (const u of this.units) {
        if (u.turn == null) continue;
        let d = u.turn - u.head;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (d > 0.01) u.head = Math.min(u.turn, u.head + dt * 1.8);
        else if (d < -0.01) u.head = Math.max(u.turn, u.head - dt * 1.8);
      }

      // unit step machine + unit drive
      for (const u of this.units) {
        if (u.st === ROUT) {
          u.dx *= 1 - Math.min(1, dt * 3);
          u.dy *= 1 - Math.min(1, dt * 3);
          continue;
        }
        const foe = this.sides[1 - u.side];
        if (
          !this.over &&
          u.st !== ROUT &&
          u.step >= u.steps.length &&
          foe.total0 > 0 &&
          foe.dead + foe.routed >= foe.total0 * HUNT_FRAC
        ) {
          u.huntT -= dt;
          if (u.huntT <= 0) {
            u.huntT = HUNT_CD;
            let be = null,
              bd = HUNT_R * HUNT_R;
            grid.query(u.cx, u.cy, HUNT_R, (b) => {
              if (b.side === u.side || b.dead || !b.fleeing) return;
              const dx = b.x - u.cx,
                dy = b.y - u.cy;
              const d2 = dx * dx + dy * dy;
              if (d2 < bd) {
                bd = d2;
                be = b;
              }
            });
            if (be) {
              u.tx = be.x;
              u.ty = be.y;
              if (u.st !== CHARGE && u.st !== ADV)
                u.st = u.role === CAV || u.role === LCAV ? CHARGE : ADV;
              const hd = Math.atan2(be.y - u.cy, be.x - u.cx);
              u.head = hd;
              u.turn = hd;
            }
          }
        }
        const stp = u.steps[u.step];
        if (stp) {
          if (u.st === CHARGE) {
            if (Math.hypot(u.tx - u.cx, u.ty - u.cy) < 95 && u.step < u.steps.length)
              this._advance(agents, u);
          } else if (stp.hold != null && bt - u.stepT >= stp.hold) {
            this._advance(agents, u);
          } else if (
            u.st === ADV &&
            u.steps.length > 1 &&
            Math.hypot(u.tx - u.cx, u.ty - u.cy) < 110
          ) {
            this._advance(agents, u);
          }
        }
        const spd = UNIT_SPD[u.role][u.st];
        const dx = u.tx - u.cx,
          dy = u.ty - u.cy;
        const d = Math.hypot(dx, dy);
        if (d > 2 && spd > 0) {
          const k = Math.min(1, dt * 1.6);
          u.dx += ((dx / d) * spd - u.dx) * k;
          u.dy += ((dy / d) * spd - u.dy) * k;
        } else {
          u.dx *= 1 - Math.min(1, dt * 3);
          u.dy *= 1 - Math.min(1, dt * 3);
        }
      }

      // a unit that bleeds out too fast breaks
      for (const u of this.units) {
        if (u.st !== ROUT && u.alive <= u.size0 * UNIT_BREAK[u.side]) {
          u.st = ROUT;
          for (let i = 0; i < u.mem.length; i++) if (!u.mem[i].dead) this._setRout(u.mem[i]);
        }
      }

      // the battle ends only when one side is annihilated (dead or fled)
      if (!this.over) {
        for (let s = 0; s < 2; s++) {
          const sd = this.sides[s];
          if (sd.dead + sd.gone >= sd.total0) {
            this.result = s === ROME ? CAR : ROME;
            this.over = true;
            for (const u of this.units) {
              if (u.side === s) {
                u.st = ROUT;
                for (let i = 0; i < u.mem.length; i++) if (!u.mem[i].dead) this._setRout(u.mem[i]);
              } else if (u.st !== ROUT) {
                // the victors hold the field (no more converging on one point)
                u.st = HOLD;
                u.tx = u.cx;
                u.ty = u.cy;
                u.turn = null;
              }
            }
            break;
          }
        }
      }
    }

    update(a, dt, t, grid, nav, _world, _buildings, _wave) {
      a.rallyT = Math.max(0, a.rallyT - dt);
      if (a.fleeing && a.rallyT <= 0) {
        this._flee(a, dt, grid);
        return;
      }
      if (this.over) {
        // the field is decided: the victors re-form their ranks and hold —
        // the same calm seek as the HOLD branch (it also un-packs the
        // pursuit clump, so the crowd settles instead of milling)
        this._seekSlot(a, this.units[a.un], dt, 40, true);
        return;
      }
      switch (a.role) {
        case HEAVY:
          this._updateHeavy(a, dt, t, grid, nav);
          break;
        case SLINGER:
          this._updateSlinger(a, dt, grid);
          break;
        case CAV:
          this._updateCav(a, dt, t, grid, nav, 172, 24, 2);
          break;
        default:
          this._updateCav(a, dt, t, grid, nav, 150, 20, 2);
      }
    }

    /* ---------- movement ---------- */

    // seek the agent's slot in the unit formation; the unit drive carries
    // the block, the slot seek keeps it shaped
    _seekSlot(a, u, dt, sp, faceHead) {
      const ch = Math.cos(u.head),
        sh = Math.sin(u.head);
      const sx = u.cx + a.sx * sh + a.sy * ch;
      const sy = u.cy - a.sx * ch + a.sy * sh;
      a.sx2 = sx;
      a.sy2 = sy;
      const dx = sx - a.x,
        dy = sy - a.y;
      const d = Math.hypot(dx, dy);
      const k = Math.min(1, dt * 2.4);
      // the unit drive carries the block even while every agent sits on its
      // slot; the slot seek only shapes the edges, so it stays gated
      let txv = u.dx,
        tyv = u.dy;
      if (d > 9) {
        txv += (dx / d) * sp;
        tyv += (dy / d) * sp;
        a.a = faceHead ? u.head : Math.atan2(dy, dx);
      }
      a.vx += (txv - a.vx) * k;
      a.vy += (tyv - a.vy) * k;
      a.wantMove = d > 9 || u.dx * u.dx + u.dy * u.dy > 16;
    }

    _seekPt(a, u, dt, sp) {
      const dx = u.tx - a.x,
        dy = u.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        const k = Math.min(1, dt * 2.4);
        a.vx += (dx * (sp / d) + u.dx * 0.3 - a.vx) * k;
        a.vy += (dy * (sp / d) + u.dy * 0.3 - a.vy) * k;
        a.a = Math.atan2(dy, dx);
        a.wantMove = true;
      }
    }

    _flee(a, dt, grid) {
      if (a.rallyT > 0) return; // rallied: hold the ground instead
      if (a.fdirC < -900) {
        // aim once, at the rout: the exit most away from the nearest
        // enemy, and keep it. Re-aiming every couple of seconds let a
        // clump of routiers orbit the circling pursuit forever — the
        // field never cleared and the battle could not end
        let be = null,
          bd = 200 * 200;
        grid.query(a.x, a.y, 200, (b) => {
          if (b.side === a.side || b.dead) return;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bd) {
            bd = d2;
            be = b;
          }
        });
        const away = be ? Math.atan2(a.y - be.y, a.x - be.x) : a.a + Math.PI;
        // of the four exits, take the one most away-from-enemy (distance is a small tiebreak)
        const W = this.w,
          H = this.h;
        const cands = [
          { an: Math.PI, d: a.x + EXIT_PAD },
          { an: 0, d: W + EXIT_PAD - a.x },
          { an: -Math.PI / 2, d: a.y + EXIT_PAD },
          { an: Math.PI / 2, d: H + EXIT_PAD - a.y },
        ];
        let best = cands[0],
          bs = -2;
        for (let i = 0; i < cands.length; i++) {
          const sc = Math.cos(cands[i].an - away) * 2 - cands[i].d / (W + H);
          if (sc > bs) {
            bs = sc;
            best = cands[i];
          }
        }
        // per-agent spread so the rout streams, not columns
        a.fdirC = best.an + (ZS.hash(a.seed + 11) * 2 - 1) * 0.3;
      }
      a.fdir = a.fdirC;
      const sp = FLEE_SP[a.role];
      const k = Math.min(1, dt * 4);
      a.a = a.fdir;
      a.vx += (Math.cos(a.fdir) * sp - a.vx) * k;
      a.vy += (Math.sin(a.fdir) * sp - a.vy) * k;
      a.wantMove = true;
    }

    /* ---------- per-type steering ---------- */

    _updateHeavy(a, dt, t, grid, nav) {
      const u = this.units[a.un];
      a.atkCd -= dt;
      a.atk = Math.max(0, a.atk - dt);
      // nearest enemy in spear reach
      let be = null,
        bd = ENG * ENG;
      grid.query(a.x, a.y, ENG + 5, (b) => {
        if (b.side === a.side || b.dead) return;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) {
          bd = d2;
          be = b;
        }
      });
      if (be) {
        a.a = Math.atan2(be.y - a.y, be.x - a.x);
        const d = Math.sqrt(bd);
        const k = Math.max(0, 1 - dt * 7);
        a.vx *= k;
        a.vy *= k; // brace: shed momentum into the line
        if (d > ENG - 5) {
          a.vx += Math.cos(a.a) * 46 * dt;
          a.vy += Math.sin(a.a) * 46 * dt;
          a.wantMove = true;
        }
        if (a.atkCd <= 0 && d < ENG) {
          a.atkCd = ATK_CD * (0.8 + ZS.hash(a.seed) * 0.5);
          a.atk = 0.16;
          this._hit(a, be, 1);
        }
        this._shout(a, dt);
      } else {
        this._seekSlot(a, u, dt, 58, true);
        if (a.stuckT > 1.2) {
          TG.x = a.sx2;
          TG.y = a.sy2;
          ZS.planAndFollow(a, TG, true, 58, dt, t, nav);
        }
      }
      this._morale(a, dt, grid);
    }

    _updateSlinger(a, dt, grid) {
      const u = this.units[a.un];
      a.thrCd -= dt;
      a.thr = Math.max(0, a.thr - dt);
      // nearest enemy in sling range
      let be = null,
        bd = SLNG_R * SLNG_R;
      grid.query(a.x, a.y, SLNG_R, (b) => {
        if (b.side === a.side || b.dead) return;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) {
          bd = d2;
          be = b;
        }
      });
      if (be) {
        a.a = Math.atan2(be.y - a.y, be.x - a.x);
        const d = Math.sqrt(bd);
        if (d < SLNG_IN) {
          // slingers don't fight: back off
          const fa = a.a + Math.PI;
          const k = Math.min(1, dt * 3);
          a.vx += (Math.cos(fa) * 84 - a.vx) * k;
          a.vy += (Math.sin(fa) * 84 - a.vy) * k;
          a.wantMove = true;
        } else if (d > SLNG_OUT) {
          const k = Math.min(1, dt * 2.4);
          a.vx += (Math.cos(a.a) * 46 - a.vx) * k;
          a.vy += (Math.sin(a.a) * 46 - a.vy) * k;
          a.wantMove = true;
        } else if (a.thrCd <= 0) {
          a.thrCd = SLNG_CD * (0.85 + ZS.hash(a.seed) * 0.3);
          a.thr = 0.22;
          this.fx.push({
            x0: a.x + Math.cos(a.a) * 10,
            y0: a.y - 8,
            x1: be.x,
            y1: be.y - 4,
            t: 0.25,
            sling: true,
            seed: Math.random() * 997,
          });
          this._hit(a, be, 1);
        }
      } else {
        this._seekSlot(a, u, dt, 40, true);
      }
      this._morale(a, dt, grid);
    }

    _updateCav(a, dt, t, grid, nav, chargeSp, hitR, dmg) {
      const u = this.units[a.un];
      a.hitCd -= dt;
      if (u.st === CHARGE) {
        a.a = u.head;
        const k = Math.min(1, dt * 2.6);
        a.vx += (Math.cos(u.head) * chargeSp - a.vx) * k;
        a.vy += (Math.sin(u.head) * chargeSp - a.vy) * k;
        a.wantMove = true;
        if (a.hitCd <= 0) {
          let be = null,
            bd = hitR * hitR;
          grid.query(a.x, a.y, hitR + 4, (b) => {
            if (b.side === a.side || b.dead) return;
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) {
              bd = d2;
              be = b;
            }
          });
          if (be) {
            a.hitCd = 0.4;
            this._hit(a, be, dmg);
            // momentum takes the victim off his feet
            be.vx += Math.cos(u.head) * 130;
            be.vy += Math.sin(u.head) * 130;
          }
        }
      } else if (u.st === HOLD) {
        this._seekSlot(a, u, dt, 40, true);
      } else {
        this._seekPt(a, u, dt, 112);
        if (a.stuckT > 1.2) {
          TG.x = u.tx;
          TG.y = u.ty;
          ZS.planAndFollow(a, TG, true, 112, dt, t, nav);
        }
      }
      this._morale(a, dt, grid);
    }

    /* ---------- combat ---------- */

    _hit(a, be, dmg) {
      let d = dmg;
      if (be.fleeing) d += 1; // a spear in the back of a fleeing man
      be.hp -= d;
      be.flash = 0.3;
      this.fx.push({
        x: (a.x + be.x) / 2,
        y: (a.y + be.y) / 2,
        t: 0.22,
        clash: true,
        seed: Math.random() * 997,
      });
      if (Math.random() < 0.5) {
        this.fx.push({ x: be.x, y: be.y - 4, t: 0.4, blood: 2, seed: Math.random() * 997 });
        if (this.stains && Math.random() < 0.5)
          this.stains.splat(be.x, be.y, "cut", Math.random() * 997);
      }
      if (be.hp <= 0) this._kill(be, a);
    }

    _kill(a, killer) {
      a.dead = true;
      a.hp = 0;
      const s = this.sides[a.side],
        u = this.units[a.un];
      s.dead++;
      // a routed man leaves the routed bucket when he dies, a fighting man
      // leaves the alive bucket; the invariant is dead+routed+alive=total0
      if (a.routFlag) s.routed--;
      else s.alive--;
      if (!a.routFlag) u.alive--;
      if (this.stains) this.stains.corpse(a);
      this.fx.push({ x: a.x, y: a.y, t: 0.3, poof: true, seed: a.seed });
      this.fx.push({ x: a.x, y: a.y - 4, t: 0.45, blood: 2, seed: a.seed + 11 });
      if (killer && !killer.dead) killer.flash = 0.1;
    }

    _setRout(a) {
      if (a.routFlag) return;
      a.routFlag = 1;
      a.fleeing = true;
      a.free = true;
      const s = this.sides[a.side],
        u = this.units[a.un];
      s.routed++;
      s.alive--;
      u.alive--; // routed men no longer count as fighting strength
      if (a.leader && a.sayT <= 0) {
        a.say = "they're breaking!";
        a.sayT = a.sayMax = 1.5;
      }
      this.fx.push({ x: a.x, y: a.y - 6, t: 0.3, poof: true, seed: a.seed });
    }

    // morale is local: too many enemies around, neighbors fleeing, or
    // caught from front and rear — and the man turns his back
    _morale(a, dt, grid) {
      if (a.routFlag) return;
      a.morT -= dt;
      if (a.morT > 0) return;
      a.morT = 0.45 + ZS.hash(a.seed + 3) * 0.5;
      let f = 0,
        fr = 0,
        e = 0,
        ef = 0,
        er = 0;
      const ca = Math.cos(a.a),
        sa = Math.sin(a.a);
      grid.query(a.x, a.y, MOR_R, (b) => {
        if (b === a) return;
        if (b.side === a.side) {
          f++;
          if (b.fleeing) fr++;
          return;
        }
        e++;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        if (dx * ca + dy * sa > 0) ef++;
        else er++;
      });
      if (!e) return;
      const press = e / (f + e + 1);
      let brk = false;
      if (press > 0.75 && e >= 6) brk = true;
      else if (fr >= 3 && press > 0.45) brk = true;
      else if (ef > 0 && er >= 2 && press > 0.35) brk = true;
      if (brk && a.rallyT <= 0) this._setRout(a);
    }

    _shout(a, dt) {
      if (!a.leader || a.sayCd > 0 || a.sayT > 0 || this.talkingNow >= SAY_MAX) return;
      a.sayCd -= dt;
      if (a.sayCd <= 0 && Math.random() < dt * 0.05) {
        const P = a.side === ROME ? ROM_PHRASES : CAR_PHRASES;
        a.say = P[(Math.random() * P.length) | 0];
        a.sayT = a.sayMax = 1.5;
        a.sayCd = 14 + Math.random() * 16;
      }
    }

    /* ---------- unit script ---------- */

    // move a unit to the next scripted step (or hold, when the script ends)
    _advance(agents, u) {
      u.step++;
      if (u.step >= u.steps.length) {
        u.st = HOLD;
        u.tx = u.cx;
        u.ty = u.cy;
        u.turn = u.head;
        return;
      }
      const s = u.steps[u.step];
      u.st = s.st;
      u.stepT = this.bt;
      if (s.pick) {
        const p = this._pickTarget(agents, u, s.pick === "routed");
        u.tx = p.x;
        u.ty = p.y;
      } else {
        u.tx = s.tx;
        u.ty = s.ty;
      }
      if (u.st === CHARGE || u.st === DIS) u.head = Math.atan2(u.ty - u.cy, u.tx - u.cx);
      u.turn = s.turn != null ? s.turn : u.head;
    }

    // a charge target: the nearest cluster of the enemy (fleeing if asked)
    _pickTarget(agents, u, fleeing) {
      let bx = 0,
        by = 0,
        bd = Infinity;
      for (let i = 0; i < agents.length; i++) {
        const b = agents[i];
        if (b.side === u.side || b.dead) continue;
        if (fleeing && !b.fleeing) continue;
        const dx = b.x - u.cx,
          dy = b.y - u.cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) {
          bd = d2;
          bx = b.x;
          by = b.y;
        }
      }
      if (bd === Infinity) {
        // no target of that kind: fall back to any living enemy
        for (let i = 0; i < agents.length; i++) {
          const b = agents[i];
          if (b.side === u.side || b.dead) continue;
          const dx = b.x - u.cx,
            dy = b.y - u.cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bd) {
            bd = d2;
            bx = b.x;
            by = b.y;
          }
        }
      }
      return bd === Infinity ? { x: u.cx, y: u.cy } : { x: bx, y: by };
    }

    /* ---------- population ---------- */

    // find a dry band for the engagement: the armies face each other
    // east-west, so the tested rectangle spans both lines and the ground
    // between them. The river and the lake fail the test, so the armies
    // are never deployed to face each other across water.
    _findField(world, nav) {
      const S = [1, 0.85, 0.7, 0.55];
      const need = [1, 0.97, 0.93, 0.88];
      const NX = 10,
        NY = 10;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        const hw = 720 * s,
          hh = 640 * s;
        let best = null,
          bs = -1;
        for (let gy = 380; gy <= world.h - 380; gy += 220) {
          for (let gx = 380; gx <= world.w - 380; gx += 220) {
            if (gx - hw < 60 || gx + hw > world.w - 60 || gy - hh < 60 || gy + hh > world.h - 60)
              continue;
            let ok = 0;
            for (let iy = 0; iy < NY; iy++) {
              for (let ix = 0; ix < NX; ix++) {
                const x = gx - hw + (2 * hw * ix) / (NX - 1);
                const y = gy - hh + (2 * hh * iy) / (NY - 1);
                if (nav.isWalkable(x, y, true)) ok++;
              }
            }
            const sc = ok / (NX * NY);
            if (sc < need[i]) continue;
            const c =
              1 - Math.hypot(gx - world.w / 2, gy - world.h / 2) / Math.hypot(world.w, world.h);
            const score = sc * 10 + c;
            if (score > bs) {
              bs = score;
              best = { x: gx, y: gy, s };
            }
          }
        }
        if (best) return best;
      }
      return { x: world.w / 2, y: world.h / 2, s: 0.55 };
    }

    _addUnit(agents, side, role, ax, ay, head, cols, rows, steps, bulge = 0) {
      const u = {
        side,
        role,
        cx: ax,
        cy: ay,
        cx0: ax,
        cy0: ay,
        tx: ax,
        ty: ay,
        head,
        turn: head,
        st: HOLD,
        dx: 0,
        dy: 0,
        step: 0,
        steps,
        stepT: 0,
        huntT: 0,
        size0: cols * rows,
        alive: cols * rows,
        mem: [],
      };
      this.units.push(u);
      const un = this.units.length - 1;
      const ch = Math.cos(head),
        sh = Math.sin(head);
      const hp = side === ROME ? HP[role] : CAR_HP[role];
      const nav = this._nav;
      for (let k = 0; k < cols * rows; k++) {
        const col = k % cols;
        const row = (k / cols) | 0;
        const lx = (col - (cols - 1) / 2) * SP + ZS.rnd(-1.5, 1.5);
        const ly =
          ((rows - 1) / 2 - row) * SP +
          bulge * Math.sin((Math.PI * col) / (cols - 1)) +
          ZS.rnd(-1.5, 1.5);
        let x = ax + lx * sh + ly * ch;
        let y = ay - lx * ch + ly * sh;
        const p = nav.nearestWalkable(x, y, 240, true);
        if (p) {
          x = p.x;
          y = p.y;
        }
        const a = this.makeAgent(x, y, 0, {
          side,
          role,
          un,
          sx: lx,
          sy: ly,
          hp,
          leader: k === 0,
        });
        agents.push(a);
        u.mem.push(a);
        this.sides[side].alive++;
      }

      // the first step is live at deployment
      const s0 = steps[0];
      if (s0) {
        u.st = s0.st;
        if (s0.tx != null) u.tx = s0.tx;
        if (s0.ty != null) u.ty = s0.ty;
        if (s0.turn != null) u.turn = s0.turn;
      }
      return u;
    }

    // this page builds its own battlefield: no town, the Aufidus along the
    // carthaginian rear (the world's west edge), open plain between the
    // lines, and the lake Laus in the south-east where the routed legions
    // run out of ground
    terrain(world, nav) {
      world.towns = [];
      world.water({
        riverBaseX: 230,
        lake: { x: world.w * 0.66, y: world.h * 0.85, r: 210 },
        towns: false,
      });
      nav.markWater();
      world.layoutForest({ none: true });
      ZS.Buildings.generate(world, nav);
      world.placeAllTrees({
        grovePos: [
          { x: 200, y: 420 },
          { x: world.w - 230, y: 340 },
          { x: world.w - 260, y: world.h - 460 },
        ],
      });
    }

    init(agents, world, _vw, _vh, _wave) {
      this.t0 = null;
      this.bt = 0;
      this.result = 0;
      this.over = false;
      this.talkingNow = 0;
      this.trigger1 = false;
      this.trigger2 = false;
      this.anchorT = 0;
      this.pressT = 0.5;
      this.units = [];
      this.sides = [
        { total0: 0, dead: 0, routed: 0, alive: 0, gone: 0 },
        { total0: 0, dead: 0, routed: 0, alive: 0, gone: 0 },
      ];
      this.w = world.w;
      this.h = world.h;
      if (this.fx) this.fx.length = 0;
      this._nav = world.nav;
      const nav = world.nav;

      const f = this._findField(world, nav);
      this.field = f;
      const fx = f.x,
        fy = f.y,
        s = f.s;
      const rx = fx + 420 * s, // the roman line, facing west
        cx = fx - 420 * s; // the carthaginian line, facing east
      const PI = Math.PI;

      // the romans: a deep center that presses west into the gap, cavalry
      // on both ends. The carthaginians: an infantry center that yields
      // and folds into a crescent, slingers in front of it, Hasdrubal's
      // heavy cavalry on the south end and Numidians on the north. Each
      // unit's step script holds its own timings; the arrival of a charge
      // advances it to the next step.
      this._addUnit(agents, ROME, HEAVY, rx, fy - 190 * s, PI, 25, 6, [
        { st: ADV, tx: fx - 360 * s, ty: fy - 190 * s },
      ]);
      this._addUnit(agents, ROME, HEAVY, rx, fy + 190 * s, PI, 25, 6, [
        { st: ADV, tx: fx - 360 * s, ty: fy + 190 * s },
      ]);
      this._addUnit(agents, ROME, CAV, rx, fy - 470 * s, PI, 2, 13, [
        { st: HOLD, hold: 3.5 },
        { st: CHARGE, tx: 0, ty: 0 },
        { st: DIS, tx: rx + 150 * s, ty: fy - 470 * s, hold: 3 },
        { st: ADV, tx: fx - 100 * s, ty: fy - 300 * s },
      ]);
      this._addUnit(agents, ROME, CAV, rx, fy + 470 * s, PI, 2, 13, [
        { st: HOLD, hold: 3.5 },
        { st: CHARGE, tx: 0, ty: 0 },
        { st: DIS, tx: rx + 150 * s, ty: fy + 470 * s, hold: 3 },
        { st: ADV, tx: fx - 100 * s, ty: fy + 300 * s },
      ]);
      this._addUnit(
        agents,
        CAR,
        HEAVY,
        cx,
        fy - 190 * s,
        0,
        24,
        5,
        [
          { st: HOLD },
          { st: RET, tx: cx - 130 * s, ty: fy - 190 * s, turn: PI / 3 },
          { st: ADV, tx: fx - 350 * s, ty: fy - 60 * s, turn: PI / 2.5 },
        ],
        50,
      );
      this._addUnit(
        agents,
        CAR,
        HEAVY,
        cx,
        fy + 190 * s,
        0,
        24,
        5,
        [
          { st: HOLD },
          { st: RET, tx: cx - 130 * s, ty: fy + 190 * s, turn: -PI / 3 },
          { st: ADV, tx: fx - 350 * s, ty: fy + 60 * s, turn: -PI / 2.5 },
        ],
        50,
      );
      this._addUnit(agents, CAR, CAV, cx, fy + 470 * s, 0, 3, 18, [
        { st: HOLD, hold: 5.5 },
        { st: CHARGE, tx: 0, ty: 0 },
        { st: DIS, tx: fx + 620 * s, ty: fy + 380 * s, hold: 1.5 },
        { st: CHARGE, pick: "routed" },
        { st: DIS, tx: fx + 640 * s, ty: fy + 60 * s, hold: 2 },
        { st: CHARGE, pick: "routed" },
      ]);
      this._addUnit(agents, CAR, LCAV, cx, fy - 470 * s, 0, 3, 15, [
        { st: HOLD, hold: 6.5 },
        { st: CHARGE, tx: 0, ty: 0 },
        { st: DIS, tx: fx + 640 * s, ty: fy - 300 * s, hold: 1.5 },
        { st: CHARGE, pick: "routed" },
        { st: DIS, tx: fx + 600 * s, ty: fy - 40 * s, hold: 1.5 },
        { st: CHARGE, pick: "routed" },
      ]);
      this._addUnit(agents, CAR, SLINGER, cx + 180 * s, fy - 190 * s, 0, 15, 3, [{ st: SKIRM }]);
      this._addUnit(agents, CAR, SLINGER, cx + 180 * s, fy + 190 * s, 0, 15, 3, [{ st: SKIRM }]);

      // the charge targets are the opposing wings' start positions
      const rcvnSteps = this.units[U_R_CAV_N].steps;
      rcvnSteps[1].tx = this.units[U_NUMID].cx0;
      rcvnSteps[1].ty = this.units[U_NUMID].cy0;
      const rcvsSteps = this.units[U_R_CAV_S].steps;
      rcvsSteps[1].tx = this.units[U_C_CAV].cx0;
      rcvsSteps[1].ty = this.units[U_C_CAV].cy0;
      const ccavSteps = this.units[U_C_CAV].steps;
      ccavSteps[1].tx = this.units[U_R_CAV_S].cx0;
      ccavSteps[1].ty = this.units[U_R_CAV_S].cy0;
      const numidSteps = this.units[U_NUMID].steps;
      numidSteps[1].tx = this.units[U_R_CAV_N].cx0;
      numidSteps[1].ty = this.units[U_R_CAV_N].cy0;

      for (let i = 0; i < 2; i++) this.sides[i].total0 = this.sides[i].alive;
    }

    maintain() {
      // no reserves at cannae: the legions fight what they have
    }

    // 0 -> the battle is decided, a new one redeployed after a beat
    left(_agents) {
      return this.over ? 0 : 1;
    }

    counts(agents) {
      let rome = 0,
        car = 0,
        dead = 0;
      for (const a of agents) {
        if (a.dead) {
          dead++;
          continue;
        }
        if (a.side === ROME) rome++;
        else car++;
      }
      return { rome, car, dead, bt: this.bt };
    }

    // tap/click: blow the trumpets — rally the nearest line
    tap(agents, _world, wx, wy) {
      if (this.over) return;
      let nR = 0,
        nC = 0;
      for (const a of agents) {
        if (a.dead) continue;
        const dx = a.x - wx,
          dy = a.y - wy;
        if (dx * dx + dy * dy > 130 * 130) continue;
        if (a.side === ROME) nR++;
        else nC++;
      }
      const side = nR >= nC ? ROME : CAR;
      if (side === ROME && !nR) return;
      if (side === CAR && !nC) return;
      let rallied = 0;
      for (const a of agents) {
        if (a.dead || a.side !== side) continue;
        const dx = a.x - wx,
          dy = a.y - wy;
        if (dx * dx + dy * dy > 110 * 110) continue;
        a.rallyT = 7;
        rallied++;
      }
      if (!rallied) return;
      this.fx.push({ x: wx, y: wy, t: 0.7, rally: true, seed: Math.random() * 997 });
      for (const a of agents) {
        if (a.dead || a.side !== side || !a.leader) continue;
        const dx = a.x - wx,
          dy = a.y - wy;
        if (dx * dx + dy * dy < 160 * 160 && a.sayT <= 0) {
          a.say = "hold the line!";
          a.sayT = a.sayMax = 1.6;
          break;
        }
      }
    }

    /* ---------- presentation ---------- */

    hud(agents, wave) {
      const s0 = this.sides[ROME];
      const s1 = this.sides[CAR];
      const mm = ((this.bt / 60) | 0).toString().padStart(2, "0");
      const ss = ((this.bt % 60) | 0).toString().padStart(2, "0");
      if (!this._hud) {
        const overlay = { main: "", sub: "" };
        this._hud = {
          title: "",
          stats: "",
          hint: "drag to pan · wheel to zoom · tap to rally the nearest line",
          legend(c, y, fs) {
            c.lineCap = "round";
            c.lineWidth = 1.2;
            c.strokeStyle = "rgba(60,58,50,0.75)";
            // roman: red scutum
            ZS.wcirc(c, 16, y, 3.2, 5, 0.5);
            ZS.wline(c, 16, y + 3, 16, y + 9, 6, 0.4);
            ZS.wline(c, 21, y - 2, 27, y + 3, 7, 0.4);
            c.fillStyle = ROM_SHIELD;
            ZS.wpoly(
              c,
              [
                { x: 8, y: y + 1 },
                { x: 12, y: y + 1 },
                { x: 12, y: y + 9 },
                { x: 8, y: y + 9 },
              ],
              8,
              0.4,
              true,
            );
            c.fill();
            c.stroke();
            // carthaginian: blue round shield
            c.strokeStyle = "rgba(60,58,50,0.75)";
            const y2 = y + fs * 1.35;
            ZS.wcirc(c, 16, y2, 3.2, 9, 0.5);
            ZS.wline(c, 16, y2 + 3, 16, y2 + 9, 10, 0.4);
            c.fillStyle = CAR_SHIELD;
            ZS.wcirc(c, 10, y2 + 5, 3.8, 11, 0.5);
            c.fill();
            c.stroke();
            // horse
            c.strokeStyle = "rgba(60,58,50,0.75)";
            const y3 = y + fs * 2.7;
            ZS.wpoly(
              c,
              [
                { x: 7, y: y3 + 3 },
                { x: 9, y: y3 },
                { x: 19, y: y3 },
                { x: 21, y: y3 + 3 },
                { x: 9, y: y3 + 3.5 },
              ],
              12,
              0.5,
              true,
            );
            c.stroke();
            ZS.wline(c, 20, y3, 23, y3 - 3, 13, 0.4);
            ZS.wline(c, 9, y3 + 3, 9, y3 + 7, 14, 0.4);
            ZS.wline(c, 19, y3 + 3, 19, y3 + 7, 15, 0.4);
          },
          overlay: () => {
            if (!this.over) return null;
            if (this.result === CAR) {
              const sd = this.sides[ROME];
              overlay.main = "CARTHAGE — the field is won";
              overlay.sub = "rome " + sd.dead + " dead · " + sd.gone + " fled · cannae, 216 bc";
              return overlay;
            }
            const sd = this.sides[CAR];
            overlay.main = "ROME — the field is held";
            overlay.sub = "carthage " + sd.dead + " dead · " + sd.gone + " fled · cannae, 216 bc";
            return overlay;
          },
        };
      }
      this._hud.title = "cannae, 216 bc · engagement " + wave;
      this._hud.stats =
        "rome " +
        s0.dead +
        "d " +
        s0.gone +
        "f · carthage " +
        s1.dead +
        "d " +
        s1.gone +
        "f · " +
        mm +
        ":" +
        ss;
      return this._hud;
    }

    draw(c, a, t) {
      const moving = Math.hypot(a.vx, a.vy);
      if (a.role === CAV || a.role === LCAV) this._drawCav(c, a, moving);
      else if (a.role === SLINGER) this._drawSlinger(c, a, moving);
      else this._drawSoldier(c, a, moving);
      this._drawMarks(c, a, t, moving);
    }

    // shared: hit flash scribble, panic marks, the unit's little flag
    _drawMarks(c, a, t, moving) {
      const s = a.seed;
      if (a.fleeing && a.rallyT <= 0 && moving > 40) {
        c.strokeStyle = "rgba(60,55,45,0.5)";
        c.lineWidth = 1;
        const bx = -Math.cos(a.a),
          by = -Math.sin(a.a);
        ZS.wline(c, a.x + bx * 9, a.y - 14 + by * 5, a.x + bx * 15, a.y - 15 + by * 5, s + 47, 0.7);
        ZS.wline(c, a.x + bx * 8, a.y - 10 + by * 4, a.x + bx * 14, a.y - 11 + by * 4, s + 53, 0.7);
      }
      if (a.flash > 0) {
        c.strokeStyle = "rgba(150,40,30," + Math.min(0.8, a.flash).toFixed(2) + ")";
        c.lineWidth = 1.3;
        const r = 8 + (1 - a.flash) * 14;
        for (let i = 0; i < 6; i++) {
          const an = (i / 6) * 6.283 + a.seed;
          ZS.wline(
            c,
            a.x + Math.cos(an) * r * 0.4,
            a.y - 6 + Math.sin(an) * r * 0.4,
            a.x + Math.cos(an) * r,
            a.y - 6 + Math.sin(an) * r,
            s + i * 3,
            0.8,
          );
        }
      }
      if (a.leader) {
        c.strokeStyle = INK;
        c.lineWidth = 1.1;
        const fx = a.x + 5,
          fy = a.y - 30;
        ZS.wline(c, fx, a.y - 18, fx, fy, s + 59, 0.5);
        c.fillStyle = a.side === ROME ? ROM_FLAG : CAR_FLAG;
        ZS.wpoly(
          c,
          [
            { x: fx, y: fy },
            { x: fx + 7 + ZS.jit(s) * 1.2, y: fy + 2 },
            { x: fx, y: fy + 4.5 },
          ],
          s + 60,
          0.4,
          true,
        );
        c.fill();
      }
    }

    _shield(c, a, hx, hy, s) {
      const ca = Math.cos(a.a),
        sa = Math.sin(a.a);
      const px = -sa,
        py = ca;
      const ox = hx - px * 6,
        oy = hy + 4 - py * 6;
      c.lineWidth = 1.2;
      c.strokeStyle = INK;
      if (a.side === ROME) {
        // the scutum: a long rectangle on the left arm
        c.fillStyle = ROM_SHIELD;
        ZS.wpoly(
          c,
          [
            { x: ox - px * 3.4 - ca * 5, y: oy - py * 3.4 - sa * 5 },
            { x: ox + px * 3.4 - ca * 5, y: oy + py * 3.4 - sa * 5 },
            { x: ox + px * 3.4 + ca * 5, y: oy + py * 3.4 + sa * 5 },
            { x: ox - px * 3.4 + ca * 5, y: oy - py * 3.4 + sa * 5 },
          ],
          s + 33,
          0.6,
          true,
        );
        c.fill();
        c.stroke();
      } else {
        c.fillStyle = CAR_SHIELD;
        ZS.wcirc(c, ox, oy, 5, s + 33, 0.8);
        c.fill();
        c.stroke();
      }
      ZS.wline(c, hx, hy + 5, ox, oy, s + 37, 0.8);
    }

    _drawSoldier(c, a, moving) {
      const s = a.seed;
      const g = Math.sin(a.gait) * 3 * Math.min(1, moving / 26 + 0.25);
      c.strokeStyle = "rgba(40,35,25,0.14)";
      c.lineWidth = 1.2;
      ZS.wcirc(c, a.x, a.y + 5.5, 5.5, s + 3, 1.4);
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.lineCap = "round";
      const hx = a.x + ZS.sjit(s) * 0.4,
        hy = a.y - 14;
      // legs
      ZS.wline(c, a.x, a.y - 1, a.x + g + ZS.sjit(s + 1) * 0.5, a.y + 5.5, s + 11, 1.1);
      ZS.wline(c, a.x, a.y - 1, a.x - g + ZS.sjit(s + 2) * 0.5, a.y + 5.5, s + 17, 1.1);
      // body + head
      ZS.wline(c, hx, hy + 4, a.x, a.y - 1, s + 23, 1);
      ZS.wcirc(c, hx, hy, 4.2, s + 29, 0.8);
      // spear in the right hand; it lunges while the swing animation runs
      const ca = Math.cos(a.a),
        sa = Math.sin(a.a);
      const thrust = a.atk > 0 ? 6 : 0;
      const shx = hx + ca * 3,
        shy = hy + 5 + sa * 2;
      ZS.wline(
        c,
        shx - ca * 4,
        shy - sa * 2,
        shx + ca * (11 + thrust),
        shy + sa * (6 + thrust * 0.5),
        s + 31,
        0.7,
      );
      ZS.wline(c, hx, hy + 5, shx, shy, s + 39, 0.8);
      this._shield(c, a, hx, hy, s);
      // face
      c.fillStyle = INK;
      c.beginPath();
      c.arc(hx + ca * 1.6 - 0.8, hy - 0.6, 0.6, 0, 6.29);
      c.fill();
      c.beginPath();
      c.arc(hx + ca * 1.6 + 0.9, hy - 0.3, 0.6, 0, 6.29);
      c.fill();
    }

    _drawSlinger(c, a, moving) {
      const s = a.seed;
      const g = Math.sin(a.gait) * 2.6 * Math.min(1, moving / 30 + 0.25);
      c.strokeStyle = "rgba(40,35,25,0.14)";
      c.lineWidth = 1.2;
      ZS.wcirc(c, a.x, a.y + 5.5, 5, s + 3, 1.4);
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.lineCap = "round";
      const hx = a.x + ZS.sjit(s) * 0.4,
        hy = a.y - 14;
      ZS.wline(c, a.x, a.y - 1, a.x + g + ZS.sjit(s + 1) * 0.5, a.y + 5.5, s + 11, 1.1);
      ZS.wline(c, a.x, a.y - 1, a.x - g + ZS.sjit(s + 2) * 0.5, a.y + 5.5, s + 17, 1.1);
      ZS.wline(c, hx, hy + 4, a.x, a.y - 1, s + 23, 1);
      ZS.wcirc(c, hx, hy, 4.2, s + 29, 0.8);
      // both arms up, sling looping — the throw winds the arms over
      const ca = Math.cos(a.a),
        sa = Math.sin(a.a);
      const wind = a.thr > 0 ? (a.thr / 0.22 - 0.5) * 1.6 : 0;
      const ax1 = hx + ca * 7 - sa * (4 + wind * 3),
        ay1 = hy - 2 - sa * (4 + wind * 3);
      const ax2 = hx + ca * 7 + sa * (4 - wind * 3),
        ay2 = hy - 2 + sa * (4 - wind * 3);
      ZS.wline(c, hx, hy + 5, ax1, ay1, s + 31, 0.8);
      ZS.wline(c, hx, hy + 5, ax2, ay2, s + 37, 0.8);
      c.lineWidth = 1;
      ZS.wcirc(c, (ax1 + ax2) / 2 + ca * 4, (ay1 + ay2) / 2 + sa * 4, 2.6, s + 41, 0.5);
      c.stroke();
      c.fillStyle = INK;
      c.beginPath();
      c.arc(hx + ca * 1.6 - 0.8, hy - 0.6, 0.6, 0, 6.29);
      c.fill();
      c.beginPath();
      c.arc(hx + ca * 1.6 + 0.9, hy - 0.3, 0.6, 0, 6.29);
      c.fill();
    }

    _drawCav(c, a, moving) {
      const s = a.seed;
      const g = Math.sin(a.gait * 1.4) * 4 * Math.min(1, moving / 90 + 0.3);
      const ca = Math.cos(a.a),
        sa = Math.sin(a.a);
      const px = -sa,
        py = ca;
      c.strokeStyle = "rgba(40,35,25,0.14)";
      c.lineWidth = 1.2;
      ZS.wcirc(c, a.x, a.y + 4, 12, s + 3, 1.6);
      c.strokeStyle = INK;
      c.lineWidth = 1.4;
      c.lineCap = "round";
      const bx = a.x,
        by = a.y - 6;
      // horse body
      ZS.wpoly(
        c,
        [
          { x: bx - ca * 12 - px * 4.5, y: by - sa * 12 - py * 4.5 },
          { x: bx - ca * 8 + px * 4.5, y: by - sa * 8 + py * 4.5 },
          { x: bx + ca * 11 + px * 4, y: by + sa * 11 + py * 4 },
          { x: bx + ca * 7 - px * 4, y: by + sa * 7 - py * 4 },
        ],
        s + 5,
        0.8,
        true,
      );
      c.stroke();
      // neck, head
      const nx = bx + ca * 12,
        ny = by + sa * 12;
      ZS.wline(c, nx, ny, nx + ca * 7 - px * 4, ny + sa * 7 - py * 4, s + 9, 0.7);
      ZS.wline(
        c,
        nx + ca * 7 - px * 4,
        ny + sa * 7 - py * 4,
        nx + ca * 11 - px * 6,
        ny + sa * 11 - py * 1,
        s + 13,
        0.6,
      );
      // legs, striding with the gait
      const hipF = { x: bx + ca * 9, y: by + sa * 9 };
      const hipR = { x: bx - ca * 9, y: by - sa * 9 };
      ZS.wline(
        c,
        hipF.x + px * 2.5,
        hipF.y + py * 2.5,
        hipF.x + px * 2.5 + ca * g,
        hipF.y + py * 2.5 + 8,
        s + 15,
        0.9,
      );
      ZS.wline(
        c,
        hipF.x - px * 2.5,
        hipF.y - py * 2.5,
        hipF.x - px * 2.5 - ca * g,
        hipF.y - py * 2.5 + 8,
        s + 19,
        0.9,
      );
      ZS.wline(
        c,
        hipR.x + px * 2.5,
        hipR.y + py * 2.5,
        hipR.x + px * 2.5 - ca * g,
        hipR.y + py * 2.5 + 8,
        s + 21,
        0.9,
      );
      ZS.wline(
        c,
        hipR.x - px * 2.5,
        hipR.y - py * 2.5,
        hipR.x - px * 2.5 + ca * g,
        hipR.y - py * 2.5 + 8,
        s + 23,
        0.9,
      );
      // tail
      ZS.wline(c, bx - ca * 12, by - sa * 12, bx - ca * 17, by - sa * 17 + 3, s + 25, 0.8);
      // rider
      const rx = bx - px * 1,
        ry = by - 8;
      c.lineWidth = 1.3;
      ZS.wline(c, rx, ry, rx - px * 1.5, ry - 7, s + 31, 0.6);
      ZS.wcirc(c, rx - px * 1.5, ry - 10, 3, s + 33, 0.6);
      // sword arm, sword drawn
      ZS.wline(c, rx, ry - 5, rx + ca * 6, ry - 5 + sa * 3, s + 35, 0.7);
      ZS.wline(c, rx + ca * 6, ry - 5 + sa * 3, rx + ca * 12, ry - 5 + sa * 6, s + 36, 0.7);
      // the rider's shield (Numidians ride unshielded)
      if (a.role !== LCAV) {
        c.lineWidth = 1.1;
        if (a.side === ROME) {
          c.fillStyle = ROM_SHIELD;
          ZS.wpoly(
            c,
            [
              { x: rx - px * 4 - ca * 3, y: ry - 4 - py * 4 - sa * 3 },
              { x: rx + px * 2 - ca * 3, y: ry - 4 - py * -2 - sa * 3 },
              { x: rx + px * 2 + ca * 3, y: ry - 4 - py * -2 + sa * 3 },
              { x: rx - px * 4 + ca * 3, y: ry - 4 - py * 4 + sa * 3 },
            ],
            s + 37,
            0.4,
            true,
          );
          c.fill();
          c.stroke();
        } else {
          c.fillStyle = CAR_SHIELD;
          ZS.wcirc(c, rx - px * 4, ry - 4 - py * 1, 3.6, s + 37, 0.5);
          c.fill();
          c.stroke();
        }
      }
    }

    // transient effects: clash ticks, sling stones, rally rings, dust poofs,
    // blood — small particles only, in the ink register
    drawFX(c, fx) {
      for (const sh of fx) {
        if (sh.sling) {
          const k = 1 - sh.t / 0.25;
          const mx = (sh.x0 + sh.x1) / 2;
          const my = (sh.y0 + sh.y1) / 2 - 16;
          const bx = (1 - k) * (1 - k) * sh.x0 + 2 * (1 - k) * k * mx + k * k * sh.x1;
          const by = (1 - k) * (1 - k) * sh.y0 + 2 * (1 - k) * k * my + k * k * sh.y1;
          c.strokeStyle = "rgba(60,52,40," + (0.5 - k * 0.2).toFixed(2) + ")";
          c.lineWidth = 1;
          c.setLineDash([2, 3]);
          c.beginPath();
          c.moveTo(sh.x0, sh.y0);
          c.quadraticCurveTo(mx, my, sh.x1, sh.y1);
          c.stroke();
          c.setLineDash([]);
          c.fillStyle = "rgba(60,52,40,0.8)";
          c.beginPath();
          c.arc(bx, by, 1.6, 0, 7);
          c.fill();
        } else if (sh.clash) {
          const k = sh.t / 0.22;
          c.strokeStyle = "rgba(70,58,44," + (0.8 * k).toFixed(2) + ")";
          c.lineWidth = 1.2;
          for (let i = 0; i < 3; i++) {
            const an = ZS.hash(sh.seed + i) * 6.283;
            ZS.wline(
              c,
              sh.x + Math.cos(an) * 2,
              sh.y + Math.sin(an) * 2,
              sh.x + Math.cos(an) * (5 + (1 - k) * 4),
              sh.y + Math.sin(an) * (5 + (1 - k) * 4),
              sh.seed + 30 + i,
              0.5,
            );
          }
        } else if (sh.rally) {
          const k = sh.t / 0.7;
          c.strokeStyle = "rgba(61,52,43," + (0.5 * k).toFixed(2) + ")";
          c.lineWidth = 1.4;
          ZS.wcirc(c, sh.x, sh.y, 10 + (1 - k) * 34, sh.seed, 2);
        } else if (sh.poof) {
          const k = sh.t / 0.3;
          c.strokeStyle = "rgba(120,50,40," + (k * 0.7).toFixed(2) + ")";
          c.lineWidth = 1.2;
          ZS.wcirc(c, sh.x, sh.y - 6, 4 + (1 - k) * 11, sh.seed, 1.6);
        } else {
          const S = { n: 6, p: 0.5, life: 0.45, R: 11 };
          const k = sh.t / S.life;
          c.fillStyle = "rgba(180,64,52," + (0.6 * k).toFixed(2) + ")";
          for (let i = 0; i < S.n; i++) {
            if (ZS.hash(sh.seed + 200 + i) > S.p) continue;
            const ang = ZS.hash(sh.seed + i) * Math.PI * 2;
            const dist = (1 - k) * S.R * (0.45 + ZS.hash(sh.seed + 40 + i) * 0.55);
            const r = (0.5 + ZS.hash(sh.seed + 80 + i) * 1.1) * (0.5 + k * 0.8);
            c.beginPath();
            c.arc(sh.x + Math.cos(ang) * dist, sh.y + Math.sin(ang) * dist * 0.8, r, 0, 7);
            c.fill();
          }
        }
      }
    }
  }

  ZS.ScenarioCannae = ScenarioCannae;
})();
