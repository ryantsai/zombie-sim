/* ZS.figure — the stickman baseline (docs/SANGUO-DESIGN.md §7).

   §7 freezes the Cannae matchstick figure as *the* spec: one body, and every
   unit type, rank and faction is a small cheap variation on it. This file is
   that spec made executable, so nothing else in the game invents its own
   soldier. New art has to justify itself against what is here.

     drawFoot(c, a, moving)   the base body + this type's weapon    (§7.1, §7.3)
     drawRider(c, a, moving)  the mounted variant                   (§7.3)
     drawMarks(c, a, t, mv)   flash, panic, rank, sash, banner, aura(§7.4)

   Anchored at (a.x, a.y) = the point between the feet; ~20 px tall at scale 1
   and zoom 1. Every part takes `a.seed + <fixed offset>` so it boils stably
   instead of re-seeding each frame.

   The agent fields this reads: x y a seed gait vx vy side type tier flash
   fleeing rallyT atk thr hp. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const INK = "rgb(61,52,43)";
  const INK_SOFT = "rgba(61,52,43,0.5)";
  const SHADOW = "rgba(40,35,25,0.14)";

  /* Unit types — silhouette is the read (§7.3). */
  const SPEAR = 0, // 槍兵
    DAO = 1, // 刀盾兵
    BOW = 2, // 弩兵
    JI = 3, // 戟兵
    CAV = 4, // 騎兵
    HBOW = 5, // 弓騎兵
    // Heavy equipment / special — same body, weapon is the read
    CATAPULT = 6, // 投石車 — operated by a crew
    RAM = 7, // 衝車 — the siege ram
    STANDARD = 8, // 旗手 — the standard bearer (any unit type)
    HUBAO = 9, // 虎豹騎 — armoured shock cavalry
    ZHUGE = 10, // 諸葛弩 — repeating crossbow corps
    ELEPHANT = 11; // 象兵 — towered war elephants

  /* Rank tiers — size plus marks, still one body (§7.4). */
  const TROOPER = 0,
    NCO = 1,
    OFFICER = 2,
    GENERAL = 3;
  const TIER_SCALE = [1, 1.05, 1.12, 1.25];

  /* Faction ramp (§7.2). Assigned at campaign start; the player's faction
     always takes slot 0. Used as a low-alpha wash plus the ink line. */
  const FACTIONS = [
    [64, 132, 74], // player 劉 — green
    [70, 96, 150], // computer 曹 — blue
    [150, 54, 44], // red
    [150, 120, 60], // ochre
    [120, 80, 140], // violet
    [60, 130, 130], // teal
    [120, 86, 60], // brown
    [96, 104, 120], // slate
  ];

  // Reused geometry for the render LODs. These arrays are mutated in place;
  // a 4,000-figure fit view must not trade stroke cost for garbage collection.
  const MID_HORSE = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const MASS_QUAD = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const MASS_FLAG = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const ARMOR_QUAD = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const ELEPHANT_BODY = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  function wash(i, alpha) {
    const c = FACTIONS[i % FACTIONS.length];
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ")";
  }

  /* ---------- the base figure (§7.1) ---------- */

  /* Draws body and weapon. `k` is the tier scale; everything below is written
     at k = 1 and multiplied, so a general is the same drawing 25% larger. */
  function drawFoot(c, a, moving) {
    // Equipment types replace the stickman entirely (one figure = one wagon)
    if (a.type === CATAPULT) {
      drawCatapult(c, a);
      return;
    }
    if (a.type === RAM) {
      drawRam(c, a);
      return;
    }
    if (a.type === ELEPHANT) {
      drawElephant(c, a, moving);
      return;
    }
    const s = a.seed;
    const k = TIER_SCALE[a.tier || 0];
    const g = Math.sin(a.gait) * 3 * k * Math.min(1, moving / 26 + 0.25);

    c.strokeStyle = SHADOW;
    c.lineWidth = 1.2;
    ZS.wcirc(c, a.x, a.y + 5.5 * k, 5.5 * k, s + 3, 1.4);

    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.lineCap = "round";
    const hx = a.x + ZS.sjit(s) * 0.4,
      hy = a.y - 14 * k;
    // legs
    ZS.wline(c, a.x, a.y - 1, a.x + g + ZS.sjit(s + 1) * 0.5, a.y + 5.5 * k, s + 11, 1.1);
    ZS.wline(c, a.x, a.y - 1, a.x - g + ZS.sjit(s + 2) * 0.5, a.y + 5.5 * k, s + 17, 1.1);
    // torso + head
    ZS.wline(c, hx, hy + 4 * k, a.x, a.y - 1, s + 23, 1);
    drawFootArmor(c, a, hx, hy, k);
    c.strokeStyle = INK;
    ZS.wcirc(c, hx, hy, 4.2 * k, s + 29, 0.8);

    // standard bearers replace the personal weapon with a tall pole + cloth
    if (a.type === STANDARD && !a.flagDropped) {
      drawStandard(c, a, hx, hy, k);
    } else {
      drawWeapon(c, a, hx, hy, k);
    }

    // face: one dot on the forward side
    const ca = Math.cos(a.a);
    c.fillStyle = INK;
    c.beginPath();
    c.arc(hx + ca * 1.6 * k - 0.8, hy - 0.6, 0.6 * k, 0, 6.29);
    c.fill();
    c.beginPath();
    c.arc(hx + ca * 1.6 * k + 0.9, hy - 0.3, 0.6 * k, 0, 6.29);
    c.fill();
  }

  /* Mid LOD: keep exactly the silhouette-bearing parts — head, torso and
     weapon — while omitting gait, face, shadow and small horse anatomy. */
  function drawMid(c, a) {
    if (a.type === CATAPULT) {
      drawCatapult(c, a);
      return;
    }
    if (a.type === RAM) {
      drawRam(c, a);
      return;
    }
    if (a.type === ELEPHANT) {
      drawMidElephant(c, a);
      return;
    }
    if (a.type === CAV || a.type === HBOW || a.type === HUBAO) {
      drawMidRider(c, a);
      return;
    }
    const s = a.seed;
    const k = TIER_SCALE[a.tier || 0];
    const hx = a.x + ZS.sjit(s) * 0.3;
    const hy = a.y - 14 * k;
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    c.lineCap = "round";
    ZS.wline(c, hx, hy + 4 * k, a.x, a.y, s + 23, 0.8);
    drawFootArmor(c, a, hx, hy, k);
    c.strokeStyle = INK;
    ZS.wcirc(c, hx, hy, 4 * k, s + 29, 0.65);
    if (a.type === STANDARD && !a.flagDropped) drawStandard(c, a, hx, hy, k);
    else drawWeapon(c, a, hx, hy, k);
  }

  function drawMidRider(c, a) {
    const s = a.seed;
    const ca = Math.cos(a.a);
    const sa = Math.sin(a.a);
    const px = -sa;
    const py = ca;
    const bx = a.x;
    const by = a.y - 6;
    setPoint(MID_HORSE[0], bx - ca * 11 - px * 4, by - sa * 11 - py * 4);
    setPoint(MID_HORSE[1], bx - ca * 8 + px * 4, by - sa * 8 + py * 4);
    setPoint(MID_HORSE[2], bx + ca * 10 + px * 4, by + sa * 10 + py * 4);
    setPoint(MID_HORSE[3], bx + ca * 7 - px * 4, by + sa * 7 - py * 4);
    c.fillStyle = wash(a.faction, 0.16);
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    ZS.wpoly(c, MID_HORSE, s + 5, 0.65, true);
    c.fill();
    c.stroke();
    const rx = bx - px;
    const ry = by - 8;
    ZS.wline(c, rx, ry, rx - px * 1.5, ry - 7, s + 31, 0.55);
    drawRiderArmor(c, a, rx, ry, ca, sa, px, py, 0.9);
    c.strokeStyle = INK;
    ZS.wcirc(c, rx - px * 1.5, ry - 10, 3, s + 33, 0.5);
    if (a.type === HBOW) {
      ZS.wcirc(c, rx + ca * 7, ry - 5 + sa * 4, 3.4, s + 36, 0.5);
      c.stroke();
    } else {
      ZS.wline(c, rx, ry - 5, rx + ca * 16, ry - 5 + sa * 9, s + 36, 0.6);
      if (a.type === HUBAO) drawHubaoMarks(c, a, bx, by, ca, sa, px, py, true);
    }
  }

  /* Far LOD: one call represents an entire still-formed unit as three rank
     washes with ink hatching and a single flag. Routed units deliberately do
     not use this path; the scenario keeps a sparse set of individual bodies. */
  function drawFarUnit(c, u) {
    const ch = Math.cos(u.head);
    const sh = Math.sin(u.head);
    let minL = Infinity;
    let maxL = -Infinity;
    let minF = Infinity;
    let maxF = -Infinity;
    let alive = 0;
    for (let i = 0; i < u.mem.length; i++) {
      const a = u.mem[i];
      if (a.dead || a.gone || a.fleeing) continue;
      const dx = a.x - u.cx;
      const dy = a.y - u.cy;
      const l = dx * sh - dy * ch;
      const f = dx * ch + dy * sh;
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
      if (f < minF) minF = f;
      if (f > maxF) maxF = f;
      alive++;
    }
    if (!alive) return;
    if (maxL - minL < 20) {
      minL -= 10;
      maxL += 10;
    }
    if (maxF - minF < 18) {
      minF -= 9;
      maxF += 9;
    }
    const bands = alive > 24 ? 3 : 2;
    const seed = u.uid * 97;
    c.fillStyle = wash(u.faction, 0.2);
    c.strokeStyle = wash(u.faction, 0.58);
    c.lineWidth = 1.15;
    for (let b = 0; b < bands; b++) {
      const f0 = minF + ((maxF - minF) * b) / bands;
      const f1 = minF + ((maxF - minF) * (b + 0.78)) / bands;
      setUnitPoint(MASS_QUAD[0], u, minL, f0, ch, sh);
      setUnitPoint(MASS_QUAD[1], u, maxL, f0, ch, sh);
      setUnitPoint(MASS_QUAD[2], u, maxL, f1, ch, sh);
      setUnitPoint(MASS_QUAD[3], u, minL, f1, ch, sh);
      ZS.wpoly(c, MASS_QUAD, seed + b * 11, 1.1, true);
      c.fill();
      c.stroke();
      const fm = (f0 + f1) * 0.5;
      setUnitPoint(MASS_QUAD[0], u, minL, fm, ch, sh);
      setUnitPoint(MASS_QUAD[1], u, maxL, fm, ch, sh);
      ZS.wline(
        c,
        MASS_QUAD[0].x,
        MASS_QUAD[0].y,
        MASS_QUAD[1].x,
        MASS_QUAD[1].y,
        seed + b * 11 + 5,
        0.7,
      );
    }
    if (u.general && !u.general.dead) {
      c.strokeStyle = wash(u.faction, 0.14);
      c.lineWidth = 1.2;
      ZS.wcirc(c, u.general.x, u.general.y, u.general.auraR || 90, seed + 61, 1.4);
    }
    const fx = u.cx + 5;
    const fy = u.cy - 25;
    if (u.flagUp) {
      c.strokeStyle = INK;
      c.lineWidth = 1.1;
      ZS.wline(c, fx, u.cy, fx, fy, seed + 71, 0.6);
    }
    if (u.flagUp && u.flag && ZS.flag) ZS.flag.draw(c, u.flag, fx, fy, 15, 10, 0);
    else if (u.flagUp) {
      setPoint(MASS_FLAG[0], fx, fy);
      setPoint(MASS_FLAG[1], fx + 10, fy + 2);
      setPoint(MASS_FLAG[2], fx, fy + 6);
      c.fillStyle = wash(u.faction, 0.52);
      ZS.wpoly(c, MASS_FLAG, seed + 73, 0.55, true);
      c.fill();
      c.stroke();
    }
  }

  function setPoint(p, x, y) {
    p.x = x;
    p.y = y;
  }

  function setUnitPoint(p, u, l, f, ch, sh) {
    p.x = u.cx + l * sh + f * ch;
    p.y = u.cy - l * ch + f * sh;
  }

  function drawFootArmor(c, a, hx, hy, k) {
    setPoint(ARMOR_QUAD[0], hx - 3.4 * k, hy + 3.4 * k);
    setPoint(ARMOR_QUAD[1], hx + 3.4 * k, hy + 3.4 * k);
    setPoint(ARMOR_QUAD[2], a.x + 4.2 * k, a.y - 3 * k);
    setPoint(ARMOR_QUAD[3], a.x - 4.2 * k, a.y - 3 * k);
    c.fillStyle = wash(a.faction, a.type === HUBAO ? 0.5 : 0.34);
    c.strokeStyle = INK_SOFT;
    c.lineWidth = 0.9;
    ZS.wpoly(c, ARMOR_QUAD, a.seed + 24, 0.55, true);
    c.fill();
    c.stroke();
    if (a.type === ZHUGE) {
      c.strokeStyle = wash(a.faction, 0.75);
      ZS.wline(c, hx - 3 * k, hy + 6 * k, a.x + 3.2 * k, a.y - 4 * k, a.seed + 26, 0.4);
    }
  }

  function drawRiderArmor(c, a, rx, ry, ca, sa, px, _py, k) {
    const tx = rx - px * 1.5;
    const ty = ry - 7;
    setPoint(ARMOR_QUAD[0], rx - ca * 3.2 * k, ry - sa * 3.2 * k);
    setPoint(ARMOR_QUAD[1], rx + ca * 3.2 * k, ry + sa * 3.2 * k);
    setPoint(ARMOR_QUAD[2], tx + ca * 2.7 * k, ty + sa * 2.7 * k);
    setPoint(ARMOR_QUAD[3], tx - ca * 2.7 * k, ty - sa * 2.7 * k);
    c.fillStyle = wash(a.faction, a.type === HUBAO ? 0.58 : 0.38);
    c.strokeStyle = INK_SOFT;
    c.lineWidth = 0.9;
    ZS.wpoly(c, ARMOR_QUAD, a.seed + 32, 0.45, true);
    c.fill();
    c.stroke();
  }

  function drawHubaoMarks(c, a, bx, by, ca, sa, px, py, mid) {
    c.strokeStyle = "rgba(45,38,31,0.72)";
    c.lineWidth = mid ? 0.9 : 1.15;
    const n = mid ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const along = -7 + i * 4.5;
      ZS.wline(
        c,
        bx + ca * along - px * 3.3,
        by + sa * along - py * 3.3,
        bx + ca * (along + 2) + px * 3.3,
        by + sa * (along + 2) + py * 3.3,
        a.seed + 140 + i * 5,
        0.45,
      );
    }
    const helmX = bx - px * 1.5;
    const helmY = by - 18;
    c.strokeStyle = wash(a.faction, 0.9);
    c.lineWidth = 1.6;
    ZS.wline(
      c,
      helmX,
      helmY,
      helmX - ca * (mid ? 5 : 8) - px * 3,
      helmY - sa * (mid ? 5 : 8) - py * 3,
      a.seed + 166,
      0.6,
    );
  }

  /* ---------- weapons: the type read (§7.3) ---------- */

  function drawWeapon(c, a, hx, hy, k) {
    const s = a.seed;
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    const shx = hx + ca * 3 * k,
      shy = hy + 5 * k + sa * 2 * k;
    c.lineWidth = 1.2;
    c.strokeStyle = INK;

    switch (a.type) {
      case DAO: {
        // short blade forward, shield on the off-arm
        const thrust = a.atk > 0 ? 4 : 0;
        ZS.wline(
          c,
          shx,
          shy,
          shx + ca * (7 + thrust) * k,
          shy + sa * (4 + thrust * 0.5) * k,
          s + 31,
          0.7,
        );
        ZS.wline(c, hx, hy + 5 * k, shx, shy, s + 39, 0.8);
        drawShield(c, a, hx, hy, k);
        break;
      }
      case BOW: {
        // crossbow held level; the tick is the stock
        const wind = a.thr > 0 ? 1.6 : 0;
        ZS.wline(
          c,
          shx - ca * 3 * k,
          shy,
          shx + ca * (8 + wind) * k,
          shy + sa * 4 * k,
          s + 31,
          0.7,
        );
        ZS.wline(
          c,
          shx + ca * 5 * k - sa * 3 * k,
          shy + sa * 3 * k + ca * 3 * k,
          shx + ca * 5 * k + sa * 3 * k,
          shy + sa * 3 * k - ca * 3 * k,
          s + 34,
          0.6,
        );
        ZS.wline(c, hx, hy + 5 * k, shx, shy, s + 39, 0.8);
        break;
      }
      case ZHUGE: {
        // Repeating crossbow: box magazine over the stock and a pumping
        // lever. `thr` snaps the whole mechanism back on every fast shot.
        const kick = a.thr > 0 ? -2.4 * k : 0;
        const px = -sa,
          py = ca;
        const bx = shx + ca * kick,
          by = shy + sa * kick;
        const tipX = bx + ca * 10 * k,
          tipY = by + sa * 10 * k;
        ZS.wline(c, bx - ca * 4 * k, by - sa * 4 * k, tipX, tipY, s + 31, 0.55);
        ZS.wline(
          c,
          tipX - px * 4.2 * k,
          tipY - py * 4.2 * k,
          tipX + px * 4.2 * k,
          tipY + py * 4.2 * k,
          s + 33,
          0.5,
        );
        const mx = bx + ca * 2 * k,
          my = by + sa * 2 * k;
        c.fillStyle = wash(a.faction, 0.48);
        c.beginPath();
        c.moveTo(mx - ca * 2.2 * k - px * 2.8 * k, my - sa * 2.2 * k - py * 2.8 * k);
        c.lineTo(mx + ca * 2.2 * k - px * 2.8 * k, my + sa * 2.2 * k - py * 2.8 * k);
        c.lineTo(mx + ca * 2.2 * k + px * 2.8 * k, my + sa * 2.2 * k + py * 2.8 * k);
        c.lineTo(mx - ca * 2.2 * k + px * 2.8 * k, my - sa * 2.2 * k + py * 2.8 * k);
        c.closePath();
        c.fill();
        c.stroke();
        const lever = a.thr > 0 ? 6 : 3;
        ZS.wline(
          c,
          bx,
          by,
          bx - ca * 2 * k + px * lever * k,
          by - sa * 2 * k + py * lever * k,
          s + 36,
          0.5,
        );
        ZS.wline(c, hx, hy + 5 * k, bx, by, s + 39, 0.8);
        break;
      }
      case JI: {
        // halberd: the long shaft plus a cross near the tip
        const thrust = a.atk > 0 ? 6 : 0;
        const tipX = shx + ca * (15 + thrust) * k,
          tipY = shy + sa * (8 + thrust * 0.5) * k;
        ZS.wline(c, shx - ca * 5 * k, shy - sa * 3 * k, tipX, tipY, s + 31, 0.7);
        const bx = tipX - ca * 3.5 * k,
          by = tipY - sa * 3.5 * k;
        ZS.wline(
          c,
          bx - sa * 3.4 * k,
          by + ca * 3.4 * k,
          bx + sa * 2 * k,
          by - ca * 2 * k,
          s + 34,
          0.5,
        );
        ZS.wline(c, hx, hy + 5 * k, shx, shy, s + 39, 0.8);
        break;
      }
      default: {
        // 槍 — the long spear, angled up at rest, level in the thrust
        const thrust = a.atk > 0 ? 6 : 0;
        const rest = a.atk > 0 ? 0 : -4 * k;
        ZS.wline(
          c,
          shx - ca * 4 * k,
          shy - sa * 2 * k - rest * 0.4,
          shx + ca * (13 + thrust) * k,
          shy + sa * (7 + thrust * 0.5) * k + rest,
          s + 31,
          0.7,
        );
        ZS.wline(c, hx, hy + 5 * k, shx, shy, s + 39, 0.8);
        drawShield(c, a, hx, hy, k);
      }
    }
  }

  /* Round shield in the faction wash, on the off-arm. */
  function drawShield(c, a, hx, hy, k) {
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    const px = -sa,
      py = ca;
    const ox = hx - px * 6 * k,
      oy = hy + 4 * k - py * 6 * k;
    c.lineWidth = 1.2;
    c.strokeStyle = INK;
    c.fillStyle = wash(a.faction, 0.34);
    ZS.wcirc(c, ox, oy, 5 * k, a.seed + 33, 0.8);
    c.fill();
    c.stroke();
    ZS.wline(c, hx, hy + 5 * k, ox, oy, a.seed + 37, 0.8);
  }

  /* ---------- equipment: catapult + ram (drawn as a footprint that
                 replaces the stickman when a.type is CATAPULT or RAM) ----- */

  /* Catapult — 投石車. A small wobbly frame on two wheels, an arm angled
     up, and a counterweight. Drawn around (a.x, a.y), facing a.a. */
  function drawCatapult(c, a, t) {
    void t; // reserved for a future "winding up" pose
    const s = a.seed;
    const k = TIER_SCALE[a.tier || 0] * 1.1;
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    // chassis
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    ZS.wline(c, a.x - 14 * k, a.y + 4, a.x + 14 * k, a.y + 4, s + 1, 0.8);
    c.strokeStyle = wash(a.faction, 0.82);
    c.lineWidth = 3;
    ZS.wline(c, a.x - 12 * k, a.y + 2.5, a.x + 12 * k, a.y + 2.5, s + 11, 0.55);
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    ZS.wline(c, a.x - 10 * k, a.y + 4, a.x - 10 * k, a.y + 8, s + 2, 0.5);
    ZS.wline(c, a.x + 10 * k, a.y + 4, a.x + 10 * k, a.y + 8, s + 3, 0.5);
    // wheels
    c.lineWidth = 1.2;
    ZS.wcirc(c, a.x - 9 * k, a.y + 9, 3.5 * k, s + 4, 0.5);
    ZS.wcirc(c, a.x + 9 * k, a.y + 9, 3.5 * k, s + 5, 0.5);
    // the A-frame
    ZS.wline(c, a.x - 8 * k, a.y + 4, a.x, a.y - 14 * k, s + 6, 0.6);
    ZS.wline(c, a.x + 8 * k, a.y + 4, a.x, a.y - 14 * k, s + 7, 0.6);
    // the arm (a single wline from the fulcrum angled up + a counterweight)
    const armX1 = a.x - ca * 4 * k,
      armY1 = a.y - 14 * k - sa * 4 * k;
    const armX2 = a.x + ca * 16 * k,
      armY2 = a.y - 14 * k + sa * 16 * k;
    c.lineWidth = 1.4;
    ZS.wline(c, armX1, armY1, armX2, armY2, s + 8, 0.6);
    // counterweight
    c.fillStyle = wash(a.faction, 0.4);
    ZS.wcirc(c, armX1, armY1, 3.2 * k, s + 9, 0.5);
    c.fill();
    c.stroke();
    // the stone (a small ball at the end of the arm)
    c.fillStyle = "rgba(120,110,90,0.7)";
    c.beginPath();
    c.arc(armX2, armY2, 2.2 * k, 0, 6.29);
    c.fill();
    c.stroke();
  }

  /* Ram — 衝車. A wobbly shed on wheels, a long log hanging from the
     roof. Crew visible as two stickmen behind. */
  function drawRam(c, a, t) {
    void t; // reserved for a future impact recoil
    const s = a.seed;
    const k = TIER_SCALE[a.tier || 0] * 1.05;
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    setPoint(ARMOR_QUAD[0], a.x - 8 * k, a.y - 12 * k);
    setPoint(ARMOR_QUAD[1], a.x + 6 * k, a.y - 12 * k);
    setPoint(ARMOR_QUAD[2], a.x + 10 * k, a.y - 6);
    setPoint(ARMOR_QUAD[3], a.x - 12 * k, a.y - 6);
    c.fillStyle = wash(a.faction, 0.3);
    ZS.wpoly(c, ARMOR_QUAD, s + 12, 0.65, true);
    c.fill();
    c.stroke();
    // the shed (a small rectangle)
    ZS.wline(c, a.x - 12 * k, a.y - 6, a.x + 10 * k, a.y - 6, s + 1, 0.6);
    ZS.wline(c, a.x - 12 * k, a.y - 6, a.x - 12 * k, a.y + 6, s + 2, 0.5);
    ZS.wline(c, a.x + 10 * k, a.y - 6, a.x + 10 * k, a.y + 6, s + 3, 0.5);
    // the sloped roof
    ZS.wline(c, a.x - 12 * k, a.y - 6, a.x - 8 * k, a.y - 12 * k, s + 4, 0.5);
    ZS.wline(c, a.x + 10 * k, a.y - 6, a.x + 6 * k, a.y - 12 * k, s + 5, 0.5);
    ZS.wline(c, a.x - 8 * k, a.y - 12 * k, a.x + 6 * k, a.y - 12 * k, s + 6, 0.5);
    // the wheels
    c.lineWidth = 1.2;
    ZS.wcirc(c, a.x - 8 * k, a.y + 7, 3.5 * k, s + 7, 0.5);
    ZS.wcirc(c, a.x + 6 * k, a.y + 7, 3.5 * k, s + 8, 0.5);
    // the ram log — a long wline sticking out the front
    const tipX = a.x + ca * 22 * k,
      tipY = a.y + sa * 22 * k;
    c.lineWidth = 1.6;
    ZS.wline(c, a.x + 10 * k, a.y, tipX, tipY, s + 9, 0.7);
    // the metal head
    c.fillStyle = "rgba(120,110,90,0.7)";
    c.beginPath();
    c.arc(tipX, tipY, 2.2 * k, 0, 6.29);
    c.fill();
    c.stroke();
  }

  /* Standard bearer — replaces the body weapon with a tall banner pole
     that has the faction flag on it. Keeps the same stickman body so it
     reads as a "man with a flag" rather than a new unit.

     If `a.flag` is set, the cloth is drawn from the full ZS.flag system
     (shape, color, text, all from a preset like `shu` / `cao_cao` /
     `flag_wei_cao`). Otherwise the bearer carries the generic faction
     sash — backwards compatible with callers that never set a.flag. */
  function drawStandard(c, a, hx, hy, k) {
    const s = a.seed;
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    // the pole
    const poleX = hx - 4 * k,
      poleTop = hy - 30 * k;
    const poleBot = hy + 5 * k;
    ZS.wline(c, poleX, poleBot, poleX, poleTop, s + 31, 0.5);
    const w = 12 * k;
    if (a.flag && ZS.flag && ZS.flag.draw) {
      // the full flag, scaled to the bearer's reach
      const fy = poleTop - 1;
      ZS.flag.draw(c, a.flag, poleX - w, fy, w * 1.6, 18 * k, 0);
    } else {
      // the cloth: two wpoly waves on the pole
      c.fillStyle = wash(a.faction, 0.6);
      ZS.wpoly(
        c,
        [
          { x: poleX, y: poleTop + 2 },
          { x: poleX - w, y: poleTop + 2 + ZS.sjit(s) * 0.6 },
          { x: poleX - w, y: poleTop + 18 * k },
          { x: poleX, y: poleTop + 16 * k },
        ],
        s + 33,
        0.6,
        true,
      );
      c.fill();
      c.stroke();
      // a glyph square — a single wline on the cloth (e.g. a 將 character mark)
      c.strokeStyle = INK_SOFT;
      c.lineWidth = 1.2;
      ZS.wline(c, poleX - w * 0.5, poleTop + 6 * k, poleX - w * 0.5, poleTop + 12 * k, s + 35, 0.4);
      ZS.wline(c, poleX - w * 0.7, poleTop + 9 * k, poleX - w * 0.3, poleTop + 9 * k, s + 36, 0.4);
    }
  }

  /* War elephant — a broad grey body, faction-coloured armour blanket,
     tusks, swinging trunk, and a small fighting platform. It deliberately
     exceeds the ordinary 20 px silhouette: the size is the tactical read. */
  function drawElephant(c, a, moving) {
    const s = a.seed;
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    const px = -sa,
      py = ca;
    const bx = a.x,
      by = a.y - 10;
    const gait = Math.sin(a.gait * 0.82) * 4 * Math.min(1, moving / 55 + 0.2);

    c.strokeStyle = SHADOW;
    c.lineWidth = 1.3;
    ZS.wcirc(c, a.x, a.y + 4, 19, s + 3, 2.1);

    setPoint(ELEPHANT_BODY[0], bx - ca * 15 - px * 8, by - sa * 15 - py * 8);
    setPoint(ELEPHANT_BODY[1], bx - ca * 14 + px * 8, by - sa * 14 + py * 8);
    setPoint(ELEPHANT_BODY[2], bx + ca * 14 + px * 8, by + sa * 14 + py * 8);
    setPoint(ELEPHANT_BODY[3], bx + ca * 16 - px * 8, by + sa * 16 - py * 8);
    c.fillStyle = "rgba(121,122,111,0.5)";
    c.strokeStyle = INK;
    c.lineWidth = 1.55;
    ZS.wpoly(c, ELEPHANT_BODY, s + 5, 1.05, true);
    c.fill();
    c.stroke();

    // Four massive legs alternate rather than using the horse's gallop.
    for (let i = 0; i < 4; i++) {
      const front = i < 2 ? 8 : -8;
      const across = i % 2 ? 5 : -5;
      const lx = bx + ca * front + px * across;
      const ly = by + sa * front + py * across;
      const step = (i % 2 ? -gait : gait) * 0.55;
      ZS.wline(c, lx, ly + 4, lx + ca * step, a.y + 8 + (i % 2) * 1.5, s + 17 + i * 5, 0.9);
    }

    // Armoured blanket: the same exact colour ramp as the formation flag.
    setPoint(ARMOR_QUAD[0], bx - ca * 10 - px * 7, by - sa * 10 - py * 7);
    setPoint(ARMOR_QUAD[1], bx - ca * 10 + px * 7, by - sa * 10 + py * 7);
    setPoint(ARMOR_QUAD[2], bx + ca * 7 + px * 7, by + sa * 7 + py * 7);
    setPoint(ARMOR_QUAD[3], bx + ca * 7 - px * 7, by + sa * 7 - py * 7);
    c.fillStyle = wash(a.faction, 0.48);
    c.strokeStyle = INK_SOFT;
    c.lineWidth = 1;
    ZS.wpoly(c, ARMOR_QUAD, s + 41, 0.75, true);
    c.fill();
    c.stroke();

    const hx = bx + ca * 18,
      hy = by + sa * 18;
    c.fillStyle = "rgba(121,122,111,0.55)";
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    ZS.wcirc(c, hx, hy, 7.2, s + 49, 0.85);
    c.fill();
    // Ear, tusks, and a two-joint trunk with a slow independent sway.
    ZS.wcirc(c, hx - ca * 3 + px * 5, hy - sa * 3 + py * 5, 4.8, s + 53, 0.7);
    const swing = Math.sin(a.gait * 0.44 + s) * 4;
    const tx = hx + ca * 7,
      ty = hy + sa * 7 + 5;
    ZS.wline(c, hx + ca * 4, hy + sa * 4, tx + px * swing * 0.3, ty, s + 57, 1);
    ZS.wline(c, tx + px * swing * 0.3, ty, tx + px * swing, ty + 10, s + 61, 1);
    c.strokeStyle = "rgba(224,213,181,0.9)";
    c.lineWidth = 1.3;
    ZS.wline(
      c,
      hx + px * 4,
      hy + py * 4,
      hx + ca * 10 + px * 3,
      hy + sa * 10 + py * 3,
      s + 65,
      0.5,
    );
    ZS.wline(
      c,
      hx - px * 4,
      hy - py * 4,
      hx + ca * 10 - px * 3,
      hy + sa * 10 - py * 3,
      s + 69,
      0.5,
    );

    // Howdah and armoured mahout.
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    ZS.wline(c, bx - ca * 7, by - sa * 7 - 8, bx + ca * 7, by + sa * 7 - 8, s + 73, 0.6);
    const rx = bx - px;
    const ry = by - 11;
    ZS.wline(c, rx, ry, rx - px, ry - 7, s + 77, 0.55);
    drawRiderArmor(c, a, rx, ry, ca, sa, px, py, 1);
    c.strokeStyle = INK;
    ZS.wcirc(c, rx - px, ry - 10, 3.1, s + 81, 0.55);
    const thrust = a.atk > 0 ? 6 : 0;
    ZS.wline(c, rx, ry - 5, rx + ca * (16 + thrust), ry - 5 + sa * 9, s + 85, 0.7);
  }

  function drawMidElephant(c, a) {
    const s = a.seed;
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    const px = -sa,
      py = ca;
    const bx = a.x,
      by = a.y - 9;
    setPoint(ELEPHANT_BODY[0], bx - ca * 14 - px * 7, by - sa * 14 - py * 7);
    setPoint(ELEPHANT_BODY[1], bx - ca * 13 + px * 7, by - sa * 13 + py * 7);
    setPoint(ELEPHANT_BODY[2], bx + ca * 14 + px * 7, by + sa * 14 + py * 7);
    setPoint(ELEPHANT_BODY[3], bx + ca * 15 - px * 7, by + sa * 15 - py * 7);
    c.fillStyle = wash(a.faction, 0.34);
    c.strokeStyle = INK;
    c.lineWidth = 1.3;
    ZS.wpoly(c, ELEPHANT_BODY, s + 5, 0.8, true);
    c.fill();
    c.stroke();
    const hx = bx + ca * 18,
      hy = by + sa * 18;
    ZS.wcirc(c, hx, hy, 6.5, s + 49, 0.65);
    ZS.wline(c, hx + ca * 4, hy + sa * 4, hx + ca * 9, hy + sa * 9 + 11, s + 57, 0.7);
    ZS.wline(c, bx - ca * 7, by - sa * 7 - 8, bx + ca * 7, by + sa * 7 - 8, s + 73, 0.5);
  }

  /* ---------- the mounted variant (§7.3) ---------- */

  function drawRider(c, a, moving) {
    if (a.type === ELEPHANT) {
      drawElephant(c, a, moving);
      return;
    }
    const s = a.seed;
    const g = Math.sin(a.gait * 1.4) * 4 * Math.min(1, moving / 90 + 0.3);
    const ca = Math.cos(a.a),
      sa = Math.sin(a.a);
    const px = -sa,
      py = ca;
    c.strokeStyle = SHADOW;
    c.lineWidth = 1.2;
    ZS.wcirc(c, a.x, a.y + 4, 12, s + 3, 1.6);
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    c.lineCap = "round";
    const bx = a.x,
      by = a.y - 6;
    // horse body
    c.fillStyle = wash(a.faction, a.type === HUBAO ? 0.3 : 0.18);
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
    c.fill();
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
    const hfx = bx + ca * 9,
      hfy = by + sa * 9;
    const hrx = bx - ca * 9,
      hry = by - sa * 9;
    ZS.wline(
      c,
      hfx + px * 2.5,
      hfy + py * 2.5,
      hfx + px * 2.5 + ca * g,
      hfy + py * 2.5 + 8,
      s + 15,
      0.9,
    );
    ZS.wline(
      c,
      hfx - px * 2.5,
      hfy - py * 2.5,
      hfx - px * 2.5 - ca * g,
      hfy - py * 2.5 + 8,
      s + 19,
      0.9,
    );
    ZS.wline(
      c,
      hrx + px * 2.5,
      hry + py * 2.5,
      hrx + px * 2.5 - ca * g,
      hry + py * 2.5 + 8,
      s + 21,
      0.9,
    );
    ZS.wline(
      c,
      hrx - px * 2.5,
      hry - py * 2.5,
      hrx - px * 2.5 + ca * g,
      hry - py * 2.5 + 8,
      s + 23,
      0.9,
    );
    // tail
    ZS.wline(c, bx - ca * 12, by - sa * 12, bx - ca * 17, by - sa * 17 + 3, s + 25, 0.8);
    // rider
    const rx = bx - px,
      ry = by - 8;
    c.lineWidth = 1.3;
    ZS.wline(c, rx, ry, rx - px * 1.5, ry - 7, s + 31, 0.6);
    drawRiderArmor(c, a, rx, ry, ca, sa, px, py, 1);
    c.strokeStyle = INK;
    ZS.wcirc(c, rx - px * 1.5, ry - 10, 3, s + 33, 0.6);
    if (a.type === HBOW) {
      // bow held across: two short arms and a curve
      ZS.wline(c, rx, ry - 5, rx + ca * 5 - px * 3, ry - 5 + sa * 3, s + 35, 0.7);
      c.lineWidth = 1;
      ZS.wcirc(c, rx + ca * 7, ry - 5 + sa * 4, 3.4, s + 36, 0.6);
      c.stroke();
    } else {
      // lance, couched
      ZS.wline(c, rx, ry - 5, rx + ca * 6, ry - 5 + sa * 3, s + 35, 0.7);
      ZS.wline(c, rx + ca * 6, ry - 5 + sa * 3, rx + ca * 16, ry - 5 + sa * 9, s + 36, 0.7);
      c.lineWidth = 1.1;
      c.fillStyle = wash(a.faction, 0.3);
      ZS.wcirc(c, rx - px * 4, ry - 4 - py, 3.6, s + 37, 0.5);
      c.fill();
      c.stroke();
    }
    if (a.type === HUBAO) drawHubaoMarks(c, a, bx, by, ca, sa, px, py, false);
  }

  /* ---------- rank marks, sash, banner, aura (§7.4) ---------- */

  function drawMarks(c, a, t, moving) {
    const s = a.seed;
    const k = TIER_SCALE[a.tier || 0];

    // panic: motion ticks trailing a running man
    if (a.fleeing && a.rallyT <= 0 && moving > 40) {
      c.strokeStyle = "rgba(60,55,45,0.5)";
      c.lineWidth = 1;
      const bx = -Math.cos(a.a),
        by = -Math.sin(a.a);
      ZS.wline(c, a.x + bx * 9, a.y - 14 + by * 5, a.x + bx * 15, a.y - 15 + by * 5, s + 47, 0.7);
      ZS.wline(c, a.x + bx * 8, a.y - 10 + by * 4, a.x + bx * 14, a.y - 11 + by * 4, s + 53, 0.7);
    }

    // hit flash: a red scribble blooming outward
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

    const tier = a.tier || 0;
    if (tier === TROOPER) return;

    // 什長 and up carry the little unit flag
    c.strokeStyle = INK;
    c.lineWidth = 1.1;
    const fx = a.x + 5 * k,
      fy = a.y - 30 * k;
    ZS.wline(c, fx, a.y - 18 * k, fx, fy, s + 59, 0.5);
    c.fillStyle = wash(a.faction, 0.55);
    ZS.wpoly(
      c,
      [
        { x: fx, y: fy },
        { x: fx + (7 + ZS.jit(s) * 1.2) * k, y: fy + 2 },
        { x: fx, y: fy + 4.5 * k },
      ],
      s + 60,
      0.4,
      true,
    );
    c.fill();

    // 校尉 and up wear the faction sash across the torso
    if (tier >= OFFICER) {
      c.strokeStyle = wash(a.faction, 0.75);
      c.lineWidth = 1.6;
      ZS.wline(c, a.x - 3.5 * k, a.y - 12 * k, a.x + 3.5 * k, a.y - 5 * k, s + 63, 0.7);
    }

    // 將: the leadership aura and a named banner
    if (tier === GENERAL) {
      const r = a.auraR || 90;
      c.strokeStyle = wash(a.faction, 0.16);
      c.lineWidth = 1.4;
      ZS.wcirc(c, a.x, a.y, r, s + 71, r * 0.02);
      if (a.name) drawBanner(c, a, k, t);
    }
  }

  /* Vertical pole and cloth, the general's name written down it. */
  function drawBanner(c, a, k, t) {
    const s = a.seed;
    const px = a.x - 11 * k;
    const top = a.y - 46 * k;
    const bot = a.y - 16 * k;
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    ZS.wline(c, px, top, px, bot, s + 77, 0.7);
    const sway = Math.sin(t * 1.7 + s) * 0.9;
    const w = 11 * k;
    ZS.wpoly(
      c,
      [
        { x: px, y: top + 1 },
        { x: px - w, y: top + 1 + sway },
        { x: px - w, y: top + 26 * k + sway },
        { x: px, y: top + 26 * k },
      ],
      s + 79,
      0.9,
      true,
    );
    c.fillStyle = wash(a.faction, 0.22);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.stroke();
    // the name, written down the cloth
    c.fillStyle = INK;
    const size = 8 * k;
    const str = ZS.i18n ? ZS.i18n.t(a.name) : String(a.name);
    for (let i = 0; i < str.length && i < 3; i++) {
      ZS.boilText(c, str[i], px - w / 2, top + 9 * k + i * size * 1.15, size, s + 90 + i, "center");
    }
  }

  ZS.figure = {
    SPEAR,
    DAO,
    BOW,
    JI,
    CAV,
    HBOW,
    CATAPULT,
    RAM,
    STANDARD,
    HUBAO,
    ZHUGE,
    ELEPHANT,
    TROOPER,
    NCO,
    OFFICER,
    GENERAL,
    TIER_SCALE,
    FACTIONS,
    INK,
    wash,
    drawFoot,
    drawMid,
    drawFarUnit,
    drawRider,
    drawMarks,
    drawWeapon,
    drawShield,
    drawCatapult,
    drawRam,
    drawStandard,
    drawElephant,
  };
})();
