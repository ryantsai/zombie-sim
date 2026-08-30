/* ZS.Campaign — the campaign's live state (docs/SANGUO-DESIGN.md §4.1, §5.3).

   One object holds everything a saved game is: the turn clock, the provinces
   and who holds them, the factions and their purses, and every army on the
   board. `capture()` returns it as plain JSON and `apply()` puts it back —
   that pair is registered with ZS.SaveManager as the "campaign" section, which
   is the whole of the P3 save story.

   Content lives in js/campaign/data/*.js and is referenced by id. A save never
   carries a place name, a warlord's name, or a stat block: those are code, and
   code ships with the build. That is what lets the almanac grow without
   invalidating anyone's save (§5.3).

   Derived numbers — income, food yield, recruit capacity — are recomputed on
   read and never stored. A save that stored them would be a save that could
   disagree with the rules it was loaded into. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const START_YEAR = 194;
  const SEASONS = 4;

  /* Per-season yields at development level 0, by province size. */
  const BASE_INCOME = [0, 40, 80, 140];
  const BASE_FOOD = [0, 120, 240, 400];
  const BASE_RECRUIT = [0, 800, 1600, 2800];

  /* Development. Four tracks, each capped, each a flat gold price that rises
     with the level already bought. */
  const DEV_TRACKS = ["income", "food", "recruit", "wall"];
  const DEV_MAX = { income: 3, food: 3, recruit: 3, wall: 2 };
  const DEV_COST = { income: 120, food: 120, recruit: 150, wall: 260 };

  const LOYALTY_DRIFT = 3; // per season, toward the settled level
  const GARRISON_MIN = 200;

  let uid = 1;

  class Campaign {
    constructor() {
      this.seed = 0;
      this.turn = 1;
      this.playerFactionId = null;
      this.provinces = {}; // id -> live record
      this.factions = {}; // id -> live record
      this.armies = {}; // id -> ZS.Army record
      this.nextArmyId = 1;
      this.log = []; // world-phase report, newest last, trimmed
      this.over = null; // null | { winner: factionId }
      this.map = ZS.CampaignMap.build();
    }

    /* ---- clock ------------------------------------------------------- */

    get year() {
      return START_YEAR + Math.floor((this.turn - 1) / SEASONS);
    }

    get season() {
      return (this.turn - 1) % SEASONS;
    }

    dateText() {
      return ZS.i18n.date(this.year, this.season);
    }

    /* ---- construction ------------------------------------------------ */

    static create(seed, playerFactionId) {
      const camp = new Campaign();
      camp.seed = seed | 0 || 194194;
      camp.playerFactionId = playerFactionId || null;
      const rng = ZS.rng32(camp.seed);

      for (const p of ZS.data.provinces) {
        camp.provinces[p.id] = {
          id: p.id,
          owner: null,
          dev: { income: 0, food: 0, recruit: 0, wall: p.wall },
          loyalty: 55,
          garrison: GARRISON_MIN,
          governor: null,
          unrest: 0,
        };
      }

      for (const f of ZS.data.factions) {
        const held = f.start.provinces.filter((id) => camp.provinces[id]);
        camp.factions[f.id] = {
          id: f.id,
          gold: f.start.gold,
          food: f.start.food,
          /* The staff this warlord starts with, filtered to names the almanac
             actually carries (js/campaign/roster.js). A warlord the almanac has
             no entry for simply starts alone — a thin campaign, never a broken
             record. */
          generals: ZS.Roster.forFaction(f.id),
          alive: held.length > 0,
          isPlayer: f.id === playerFactionId,
        };
        /* Starting troops are split: most sit as garrisons, the rest form one
           field army at the capital. A warlord with nothing in the field is a
           warlord who cannot answer an invasion on turn 1. */
        const fieldShare = Math.round(f.start.troops * 0.4);
        const garrisonPool = f.start.troops - fieldShare;
        let weight = 0;
        for (const id of held) weight += ZS.CampaignMap.province(id).size;
        for (const id of held) {
          const pr = camp.provinces[id];
          const pd = ZS.CampaignMap.province(id);
          pr.owner = f.id;
          pr.loyalty = id === f.capital ? 80 : 60 + Math.floor(rng() * 12);
          pr.garrison = Math.max(
            GARRISON_MIN,
            Math.round((garrisonPool * pd.size) / Math.max(1, weight)),
          );
        }
        if (held.length && fieldShare > 0) {
          const a = camp.raiseArmy(f.id, f.capital, fieldShare);
          if (a) camp.staffArmy(a, f);
        }
        /* Whoever is left over and best at 政 keeps the books at home. A lord
           who rode out does not also govern — §4.1 is explicit that a general
           off marching is not a governor. */
        if (held.length) camp.appointGovernor(f.capital);
      }

      camp.recount();
      return camp;
    }

    /* ---- lookups ----------------------------------------------------- */

    def(id) {
      return ZS.CampaignMap.province(id);
    }

    prov(id) {
      return this.provinces[id] || null;
    }

    faction(id) {
      return this.factions[id] || null;
    }

    factionDef(id) {
      for (const f of ZS.data.factions) if (f.id === id) return f;
      return null;
    }

    player() {
      return this.factions[this.playerFactionId] || null;
    }

    owner(id) {
      const p = this.provinces[id];
      return p ? p.owner : null;
    }

    isPlayers(id) {
      return this.owner(id) === this.playerFactionId;
    }

    provincesOf(factionId) {
      const out = [];
      for (const id in this.provinces) if (this.provinces[id].owner === factionId) out.push(id);
      return out;
    }

    armiesAt(id) {
      const out = [];
      for (const aid in this.armies) {
        const a = this.armies[aid];
        if (a.at === id && !ZS.Army.isMarching(a)) out.push(a);
      }
      return out;
    }

    armiesOf(factionId) {
      const out = [];
      for (const aid in this.armies)
        if (this.armies[aid].faction === factionId) out.push(this.armies[aid]);
      return out;
    }

    /* ---- derived economy --------------------------------------------- */

    /* Income is size, then development, then how willing the province is to
       pay, then whoever is governing it (§4.1's province_income). A governor
       who is off marching does not govern — `governor` is cleared when they
       join an army. */
    income(id) {
      const pr = this.provinces[id];
      const pd = this.def(id);
      if (!pr || !pd || !pr.owner) return 0;
      const base = BASE_INCOME[pd.size] * (1 + pr.dev.income * 0.25);
      const willing = 0.5 + pr.loyalty / 200;
      return Math.round(base * willing * ZS.Roster.governBonus(pr.governor));
    }

    foodYield(id) {
      const pr = this.provinces[id];
      const pd = this.def(id);
      if (!pr || !pd || !pr.owner) return 0;
      const base = BASE_FOOD[pd.size] * (1 + pr.dev.food * 0.3);
      const willing = 0.55 + pr.loyalty / 220;
      /* Autumn is the harvest; winter takes it back. The season is the only
         reason a campaign turn is a season and not a month. */
      const seasonal = [1, 1.05, 1.5, 0.55][this.season];
      return Math.round(base * willing * seasonal);
    }

    recruitCap(id) {
      const pr = this.provinces[id];
      const pd = this.def(id);
      if (!pr || !pd) return 0;
      const cap = Math.round(BASE_RECRUIT[pd.size] * (1 + pr.dev.recruit * 0.3));
      /* An unwilling province will not give you its sons. */
      return Math.max(0, Math.round(cap * (0.4 + pr.loyalty / 170)) - pr.garrison);
    }

    devCost(id, track) {
      const pr = this.provinces[id];
      if (!pr || DEV_TRACKS.indexOf(track) < 0) return Infinity;
      const lvl = pr.dev[track] | 0;
      if (lvl >= DEV_MAX[track]) return Infinity;
      return DEV_COST[track] * (lvl + 1);
    }

    /* Where loyalty is heading if nothing is done: a well-fed, walled, garrisoned
       home province settles high; a freshly conquered one does not. */
    loyaltyTarget(id) {
      const pr = this.provinces[id];
      const fd = pr && pr.owner ? this.factionDef(pr.owner) : null;
      if (!pr || !fd) return 40;
      let t = 55;
      if (fd.capital === id) t += 20;
      t += pr.dev.income * 3 + pr.dev.food * 4;
      t += pr.governor ? 8 : 0;
      t -= pr.unrest * 10;
      const f = this.factions[pr.owner];
      if (f && f.food <= 0) t -= 25;
      return ZS.clamp(t, 5, 100);
    }

    /* ---- mutation ----------------------------------------------------- */

    raiseArmy(factionId, at, troops, comp) {
      if (!this.provinces[at]) return null;
      const id = "a" + this.nextArmyId++;
      const a = ZS.Army.make(id, factionId, at, troops, comp);
      a.raised = this.turn;
      this.armies[id] = a;
      return a;
    }

    /* Put the lord and their two ablest lieutenants on this stack. The lord
       rides first because command loss is the shock the battle layer models
       (P2's general-death shock), so who is carrying the banner matters. */
    staffArmy(a, fd) {
      const pool = this.factions[a.faction] ? this.factions[a.faction].generals : [];
      const order = pool.slice().sort((x, y) => {
        if (fd && x === fd.leader) return -1;
        if (fd && y === fd.leader) return 1;
        const sx = ZS.Roster.stats(x),
          sy = ZS.Roster.stats(y);
        return sy.tong + sy.wu - (sx.tong + sx.wu);
      });
      for (const gid of order) {
        if (a.generals.length >= ZS.Army.MAX_GENERALS) break;
        if (this.isBusy(gid, a.id)) continue;
        ZS.Army.assign(a, gid);
      }
      return a;
    }

    /* The best remaining administrator takes the seat. */
    appointGovernor(pid) {
      const pr = this.provinces[pid];
      if (!pr || !pr.owner) return null;
      const pool = this.factions[pr.owner] ? this.factions[pr.owner].generals : [];
      let best = null,
        bz = -1;
      for (const gid of pool) {
        if (this.isBusy(gid, null)) continue;
        const z = ZS.Roster.stats(gid).zheng;
        if (z > bz) {
          bz = z;
          best = gid;
        }
      }
      pr.governor = best;
      return best;
    }

    /* Is this general already doing something? `exceptArmy` lets a stack ask
       without tripping over itself. A general is in exactly one place — an
       army, a governor's seat, or the roster (§4.1's `location`). */
    isBusy(gid, exceptArmy) {
      for (const aid in this.armies) {
        if (aid === exceptArmy) continue;
        if (this.armies[aid].generals.indexOf(gid) >= 0) return true;
      }
      for (const pid in this.provinces) {
        if (this.provinces[pid].governor === gid) return true;
      }
      return false;
    }

    disbandArmy(aid) {
      const a = this.armies[aid];
      if (!a) return false;
      /* Men do not evaporate: a disbanded stack walks into the local garrison
         if the province is still ours, and goes home otherwise. */
      const pr = a.at ? this.provinces[a.at] : null;
      if (pr && pr.owner === a.faction) pr.garrison += a.troops;
      delete this.armies[aid];
      return true;
    }

    setOwner(id, factionId) {
      const pr = this.provinces[id];
      if (!pr) return;
      if (pr.owner === factionId) return;
      pr.owner = factionId;
      pr.loyalty = 30; // a conquest is not loved
      pr.unrest = 1;
      pr.governor = null;
      this.recount();
    }

    /* A faction with no provinces is out. Kept as a live flag rather than
       deleting the record, because armies and the log still name it. */
    recount() {
      const counts = {};
      for (const id in this.provinces) {
        const o = this.provinces[id].owner;
        if (o) counts[o] = (counts[o] || 0) + 1;
      }
      let liveCount = 0,
        last = null;
      for (const fid in this.factions) {
        const f = this.factions[fid];
        f.provinceCount = counts[fid] || 0;
        f.alive = f.provinceCount > 0 || this.armiesOf(fid).length > 0;
        if (f.alive) {
          liveCount++;
          last = fid;
        }
      }
      if (liveCount <= 1 && !this.over) this.over = { winner: last };
      return counts;
    }

    troopsOf(factionId) {
      let n = 0;
      for (const id in this.provinces) {
        if (this.provinces[id].owner === factionId) n += this.provinces[id].garrison;
      }
      for (const a of this.armiesOf(factionId)) n += a.troops;
      return n;
    }

    note(key, params) {
      this.log.push({ turn: this.turn, key, params: params || null });
      if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    }

    /* ---- save --------------------------------------------------------- */

    /* Plain JSON, no functions, no live references. `turn`, `year` and
       `playerFactionId` sit at the top because SaveManager.listSlots() reads
       them to label a save slot without parsing the rest. */
    capture() {
      return {
        seed: this.seed,
        turn: this.turn,
        year: this.year,
        season: this.season,
        playerFactionId: this.playerFactionId,
        nextArmyId: this.nextArmyId,
        provinces: this.provinces,
        factions: this.factions,
        armies: this.armies,
        log: this.log,
        over: this.over,
      };
    }

    static restore(data) {
      const camp = new Campaign();
      if (!data || typeof data !== "object") return camp;
      camp.seed = data.seed | 0;
      camp.turn = Math.max(1, data.turn | 0);
      camp.playerFactionId = data.playerFactionId || null;
      camp.nextArmyId = Math.max(1, data.nextArmyId | 0);
      camp.log = Array.isArray(data.log) ? data.log : [];
      camp.over = data.over || null;

      /* Rebuild from the *current* province and faction lists, not from what
         the save happens to contain. A build that added a province must not
         leave a hole in an old save, and one that removed a province must not
         leave a ghost. */
      for (const p of ZS.data.provinces) {
        const src = (data.provinces && data.provinces[p.id]) || null;
        camp.provinces[p.id] = {
          id: p.id,
          owner: (src && src.owner) || null,
          dev: {
            income: (src && src.dev && src.dev.income) | 0,
            food: (src && src.dev && src.dev.food) | 0,
            recruit: (src && src.dev && src.dev.recruit) | 0,
            wall: src && src.dev && typeof src.dev.wall === "number" ? src.dev.wall : p.wall,
          },
          loyalty: src && typeof src.loyalty === "number" ? src.loyalty : 55,
          garrison: src ? Math.max(0, src.garrison | 0) : GARRISON_MIN,
          governor: (src && src.governor) || null,
          unrest: src ? src.unrest | 0 : 0,
        };
      }
      for (const f of ZS.data.factions) {
        const src = (data.factions && data.factions[f.id]) || null;
        camp.factions[f.id] = {
          id: f.id,
          gold: src ? src.gold | 0 : f.start.gold,
          food: src ? src.food | 0 : f.start.food,
          generals: src && Array.isArray(src.generals) ? src.generals : ZS.Roster.forFaction(f.id),
          alive: src ? !!src.alive : false,
          isPlayer: f.id === camp.playerFactionId,
        };
      }
      if (data.armies) {
        for (const aid in data.armies) {
          const src = data.armies[aid];
          if (!src || !camp.provinces[src.at]) continue;
          if (!camp.factions[src.faction]) continue;
          const a = ZS.Army.make(src.id || aid, src.faction, src.at, src.troops, src.comp);
          a.generals = Array.isArray(src.generals)
            ? src.generals.slice(0, ZS.Army.MAX_GENERALS)
            : [];
          a.path = Array.isArray(src.path) && src.path.length ? src.path.slice() : null;
          a.left = src.left | 0;
          a.fatigue = typeof src.fatigue === "number" ? src.fatigue : 0;
          a.raised = src.raised | 0;
          a.from = camp.provinces[src.from] ? src.from : a.at;
          a.since = src.since | 0;
          camp.armies[a.id] = a;
        }
      }
      camp.recount();
      return camp;
    }
  }

  Campaign.START_YEAR = START_YEAR;
  Campaign.SEASONS = SEASONS;
  Campaign.DEV_TRACKS = DEV_TRACKS;
  Campaign.DEV_MAX = DEV_MAX;
  Campaign.DEV_COST = DEV_COST;
  Campaign.LOYALTY_DRIFT = LOYALTY_DRIFT;
  Campaign.GARRISON_MIN = GARRISON_MIN;
  Campaign.BASE_RECRUIT = BASE_RECRUIT;
  Campaign.uid = () => uid++;

  ZS.Campaign = Campaign;
})();
