/* ZS.CampaignUI — the campaign's DOM overlay (docs/SANGUO-DESIGN.md §2, §4.1).

   The canvas owns the map; this owns everything you press. Five pieces:

     the bar     date, treasury, holdings, and End Season
     the guide   one line saying what to do *right now*, driven by what is
                 selected. This game is a real-time battle wrapped in a
                 season, not a board game with a rulebook; a player who has to
                 hunt for the verb has already lost the thread. The guide is
                 the cheapest possible answer to "what do I click".
     the tip     what the pointer is over, read off the map without clicking
     the panel   whatever is selected — a province or a stack — and its orders
     the report  what happened while the season turned

   **Orders before facts.** The panel used to open with six rows of numbers
   and bury Recruit at the bottom in a 0.78rem chip. It now leads with the
   things you can *do* — full-width, priced, one per line — and keeps the
   numbers under them, because the numbers are what you check after you have
   decided, not before.

   Plus the faction picker, which is a menu panel rather than a campaign one:
   it is the last thing you do before a campaign exists.

   Every order goes through `ZS.Turn`, which is the only thing allowed to
   change campaign state. This file reads state and calls orders; it never
   writes a province or an army directly. That is what keeps "can I afford
   this" in one place instead of two.

   All text is `data-i18n` where it is static and re-rendered on locale change
   where it is not, so a mid-campaign language switch is not a reload. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (kids) for (const kid of kids) if (kid) n.appendChild(kid);
    return n;
  }

  function btn(cls, label, onClick, attrs) {
    const b = el("button", Object.assign({ class: cls }, attrs || null));
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function row(label, value, cls) {
    return el("div", { class: "cr" + (cls ? " " + cls : "") }, [
      el("span", { class: "ck", text: label }),
      el("span", { class: "cv", text: value }),
    ]);
  }

  /* A block of facts as a two-column grid rather than six full-width rows —
     the same numbers in half the height, which is what lets the orders stay
     above the fold. */
  function facts(pairs) {
    const g = el("div", { class: "cfacts" });
    for (const [k, v] of pairs) {
      if (v === null || v === undefined) continue;
      g.appendChild(el("span", { class: "fk", text: k }));
      g.appendChild(el("span", { class: "fv", text: String(v) }));
    }
    return g;
  }

  /* The faction's colour as a chip. The map's whole legend is "this colour is
     this warlord", so every place the overlay names one carries the swatch —
     the panel title, the tooltip, an army line, the picker card. */
  /* Development level as filled dots. Drawn as elements rather than typed as
     characters: index.html ships a glyph subset, and a bullet in a label is a
     glyph the subset would have to carry for the sake of four buttons. */
  function pips(level, max) {
    const g = el("span", { class: "d-pips" });
    for (let i = 0; i < max; i++)
      g.appendChild(el("i", { class: "pip" + (i < level ? " on" : "") }));
    return g;
  }

  function swatch(fd) {
    const s = el("span", { class: "cswatch" });
    if (fd) s.style.background = "rgb(" + fd.tint[0] + "," + fd.tint[1] + "," + fd.tint[2] + ")";
    else s.classList.add("none");
    return s;
  }

  const UI = {
    view: null,
    root: null,
    bar: null,
    guide: null,
    tip: null,
    panel: null,
    report: null,
    encounter: null,
    pick: null,
    built: false,
    _tipKey: "",
    _tipH: 0,

    build() {
      if (this.built) return this;
      this.root = document.getElementById("ui");

      this.bar = el("div", { id: "camp-bar", class: "camp-bar" });
      this.guide = el("div", { id: "camp-guide", class: "camp-guide" });
      this.tip = el("div", { id: "camp-tip", class: "camp-tip" });
      this.panel = el("aside", { id: "camp-panel", class: "camp-panel" });
      this.report = el("div", { id: "camp-report", class: "camp-report" });
      this.encounter = el("section", {
        id: "camp-encounter",
        class: "panel camp-encounter",
        role: "dialog",
        "aria-modal": "true",
      });
      this.pick = el("div", { id: "camp-pick", class: "panel camp-pick" });
      for (const n of [
        this.bar,
        this.guide,
        this.tip,
        this.panel,
        this.report,
        this.encounter,
        this.pick,
      ]) {
        this.root.appendChild(n);
      }

      ZS.i18n.onChange(() => {
        if (this.pick.classList.contains("on")) this.showPick();
        if (this.view) this.refresh();
        if (this.view && ZS.CampaignEvents && ZS.CampaignEvents.pending(this.view.camp)) {
          this.showEvent(ZS.CampaignEvents.pending(this.view.camp));
        }
      });
      this.built = true;
      return this;
    },

    /* ---- the faction picker -------------------------------------------- */

    /* Shown from the menu. Picking one is what creates the campaign, so this
       is also where the seed is chosen. */
    showPick() {
      this.build();
      if (ZS.UI) for (const k in ZS.UI.panels) ZS.UI.panels[k].classList.remove("on");
      const list = el("div", { class: "pick-list" });
      for (const fd of ZS.data.factions) {
        if (!fd.playable) continue;
        const held = fd.start.provinces.length;
        const card = el("button", { class: "pick-card", "data-faction": fd.id }, [
          el("span", { class: "pick-name", text: ZS.i18n.t(fd.name) }),
          el("span", {
            class: "pick-meta",
            text: ZS.i18n.t("campaign.pick.meta", {
              provinces: held,
              troops: ZS.i18n.nc(fd.start.troops),
              seat: ZS.i18n.t(ZS.CampaignMap.province(fd.capital).name),
            }),
          }),
        ]);
        const tint = fd.tint;
        card.style.borderLeftColor = "rgb(" + tint[0] + "," + tint[1] + "," + tint[2] + ")";
        card.addEventListener("click", () => this.start(fd.id));
        list.appendChild(card);
      }
      this.pick.textContent = "";
      this.pick.appendChild(el("h2", { text: ZS.i18n.t("campaign.pick.title") }));
      this.pick.appendChild(el("p", { text: ZS.i18n.t("campaign.pick.hint") }));
      this.pick.appendChild(list);
      this.pick.appendChild(
        btn("mbtn", ZS.i18n.t("menu.back"), () => {
          this.pick.classList.remove("on");
          if (ZS.UI) ZS.UI.show("main");
        }),
      );
      this.pick.classList.add("on");
    },

    start(factionId) {
      this.pick.classList.remove("on");
      const seed = (Date.now() ^ Math.floor(performance.now() * 1000)) | 0;
      ZS.App.campaign = ZS.Campaign.create(seed, factionId);
      ZS.App.go("campaign", { campaign: ZS.App.campaign });
    },

    /* ---- lifecycle ------------------------------------------------------ */

    onEnter(view) {
      this.build();
      this.view = view;
      this.root.classList.add("in-campaign");
      this.bar.classList.add("on");
      this.guide.classList.add("on");
      this.panel.classList.add("on");
      this.refresh();
      this.showReport(null);
      if (ZS.CampaignEvents && ZS.CampaignEvents.pending(view.camp)) {
        this.showEvent(ZS.CampaignEvents.pending(view.camp));
      }
    },

    onExit() {
      this.view = null;
      if (!this.root) return;
      this.root.classList.remove("in-campaign");
      this.bar.classList.remove("on");
      this.guide.classList.remove("on");
      this.tip.classList.remove("on");
      this.panel.classList.remove("on");
      this.report.classList.remove("on");
      this.encounter.classList.remove("on");
      this._tipKey = "";
    },

    /* ---- the bar --------------------------------------------------------- */

    refresh() {
      if (!this.view || !this.view.camp) return;
      this.drawBar();
      this.drawGuide();
      this.drawPanel();
      this._tipKey = ""; // whatever the tip was showing may have just changed
    },

    /* ---- the guide ------------------------------------------------------- */

    /* One sentence, always on screen, naming the next thing to do. It is
       driven entirely by what is selected, so it is never stale and never a
       rulebook: no stack held, go pick one of yours; a stack held, the map is
       now a target; a province of yours selected, the orders are on the right.
       This is the difference between a player who explores and one who
       guesses. */
    drawGuide() {
      const view = this.view;
      const camp = view.camp;
      const t = (k, p) => ZS.i18n.t(k, p);
      this.guide.textContent = "";
      if (!view.playerTurn) {
        this.guide.appendChild(
          el("span", { class: "cg-wait", text: t("campaign.guide.resolving") }),
        );
        return;
      }
      const held = view.heldArmy && view.heldArmy();
      let key = "campaign.guide.idle";
      if (held) key = "campaign.guide.army";
      else if (view.selProvince && camp.owner(view.selProvince) === camp.playerFactionId) {
        key = "campaign.guide.mine";
      } else if (view.selProvince) key = "campaign.guide.other";
      this.guide.appendChild(el("span", { class: "cg-turn", text: t("campaign.guide.turn") }));
      this.guide.appendChild(el("span", { class: "cg-say", text: t(key) }));
    },

    /* ---- the tooltip ------------------------------------------------------ */

    /* What the pointer is over, without a click — the map can then stop
       printing a garrison under all fifty-seven seats. Rebuilt only when the
       hover actually changed; a pointermove inside one province just moves the
       box. */
    showTip(cx, cy, changed) {
      const view = this.view;
      if (!view || !view.camp) return;
      const camp = view.camp;
      const t = (k, p) => ZS.i18n.t(k, p);
      const id = view.hoverProvince;
      if (!id) {
        this.hideTip();
        return;
      }
      const plan = view._plan;
      const key = id + "|" + (view.hoverArmy || "") + "|" + (plan ? plan.to + plan.err : "");
      const rebuilt = changed || key !== this._tipKey;
      if (rebuilt) {
        this._tipKey = key;
        const pd = ZS.CampaignMap.province(id);
        const pr = camp.prov(id);
        const owner = pr && pr.owner ? camp.factionDef(pr.owner) : null;
        this.tip.textContent = "";
        this.tip.appendChild(
          el("div", { class: "tip-head" }, [
            swatch(owner),
            el("span", { text: pd ? ZS.i18n.t(pd.name) : id }),
          ]),
        );
        this.tip.appendChild(
          el("div", {
            class: "tip-sub",
            text: owner ? ZS.i18n.t(owner.name) : t("campaign.prov.unheld"),
          }),
        );
        if (pr && pr.owner) {
          this.tip.appendChild(
            el("div", {
              class: "tip-line",
              text: t("campaign.tip.hold", {
                garrison: ZS.i18n.n(pr.garrison),
                loyalty: pr.loyalty,
              }),
            }),
          );
        }
        for (const a of camp.armiesAt(id)) {
          const afd = camp.factionDef(a.faction);
          this.tip.appendChild(
            el("div", { class: "tip-line" + (a.id === view.hoverArmy ? " on" : "") }, [
              swatch(afd),
              el("span", {
                text: t("campaign.army.chip", {
                  house: afd ? ZS.i18n.t(afd.house) : "?",
                  n: ZS.i18n.n(a.troops),
                }),
              }),
            ]),
          );
        }
        if (plan && plan.to === id) {
          this.tip.appendChild(
            el("div", {
              class: "tip-order" + (plan.path ? "" : " bad"),
              text: plan.path
                ? t("campaign.tip.march", { turns: plan.turns })
                : ZS.i18n.t(plan.err || "campaign.err.noRoute"),
            }),
          );
        }
      }
      /* Kept clear of the pointer, and flipped before it can run off screen.
         The height is measured only when the contents changed — reading
         offsetHeight forces layout, and this runs on every pointermove. */
      const w = 210,
        h = this._tipH || 90;
      const x = cx + 18 + w > window.innerWidth ? cx - 18 - w : cx + 18;
      const y = cy + 16 + h > window.innerHeight ? Math.max(4, cy - 16 - h) : cy + 16;
      this.tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
      this.tip.classList.add("on");
      if (rebuilt) this._tipH = this.tip.offsetHeight || 90;
    },

    hideTip() {
      if (this.tip) this.tip.classList.remove("on");
      this._tipKey = "";
    },

    /* Who you are and what you have, then the one button that ends the season.
       End Season is the loudest thing on the bar on purpose: it is the only
       control that advances time, and a player who cannot find it is stuck. */
    drawBar() {
      const camp = this.view.camp;
      const f = camp.player();
      const fd = camp.factionDef(camp.playerFactionId);
      const t = (k, p) => ZS.i18n.t(k, p);
      this.bar.textContent = "";
      this.bar.appendChild(
        el("span", { class: "cb-who" }, [
          swatch(fd),
          el("span", { class: "cb-faction", text: fd ? ZS.i18n.t(fd.name) : "" }),
        ]),
      );
      this.bar.appendChild(el("span", { class: "cb-date", text: camp.dateText() }));
      if (f) {
        const stats = el("span", { class: "cb-stats" });
        const stat = (key, value) =>
          stats.appendChild(el("span", { class: "cb-stat", text: t(key, { n: value }) }));
        stat("campaign.bar.gold", ZS.i18n.n(f.gold));
        stat("campaign.bar.food", ZS.i18n.n(f.food));
        stat("campaign.bar.provinces", camp.provincesOf(camp.playerFactionId).length);
        stat("campaign.bar.troops", ZS.i18n.nc(camp.troopsOf(camp.playerFactionId)));
        if (ZS.CampaignVictory) {
          const progress = ZS.CampaignVictory.progress(camp, camp.playerFactionId, camp.goal);
          stats.appendChild(
            el("span", {
              class: "cb-stat",
              text: t("campaign.bar.mandate", { held: progress.held, total: progress.total }),
            }),
          );
        }
        this.bar.appendChild(stats);
      }
      const acts = el("div", { class: "cb-acts" });
      acts.appendChild(
        btn("mbtn small", t("campaign.roster.open"), () => this.showRoster(), {
          id: "btn-campaign-roster",
        }),
      );
      acts.appendChild(
        btn("mbtn small", t("campaign.quit"), () => ZS.App.go("menu"), { id: "btn-quit-campaign" }),
      );
      this.endBtn = btn("mbtn small end", t("campaign.endTurn"), () => this.endTurn(), {
        id: "btn-end-turn",
      });
      acts.appendChild(this.endBtn);
      this.bar.appendChild(acts);
    },

    /* ---- the contextual panel -------------------------------------------- */

    drawPanel() {
      const camp = this.view.camp;
      this.panel.textContent = "";
      const a = this.view.selArmy ? camp.armies[this.view.selArmy] : null;
      if (a) this.panel.appendChild(this.armyBlock(camp, a));
      if (this.view.selProvince)
        this.panel.appendChild(this.provinceBlock(camp, this.view.selProvince));
      if (!this.panel.childNodes.length) {
        this.panel.appendChild(el("p", { class: "faint", text: ZS.i18n.t("campaign.hint") }));
      }
    },

    provinceBlock(camp, id) {
      const t = (k, p) => ZS.i18n.t(k, p);
      const pd = ZS.CampaignMap.province(id);
      const pr = camp.prov(id);
      const owner = pr.owner ? camp.factionDef(pr.owner) : null;
      const mine = pr.owner === camp.playerFactionId;
      const box = el("section", { class: "cblock", "data-province": id });

      box.appendChild(
        el("h3", { class: "ctitle" }, [swatch(owner), el("span", { text: ZS.i18n.t(pd.name) })]),
      );
      box.appendChild(
        el("div", {
          class: "csub",
          text: t("campaign.prov.sub", {
            region: ZS.i18n.t(ZS.data.regions[pd.region].name),
            owner: owner ? ZS.i18n.t(owner.name) : t("campaign.prov.unheld"),
          }),
        }),
      );

      /* Any stack standing here, as the first thing you can press: a stack is
         the piece that *does* something, and finding it used to mean scrolling
         past six rows of yield figures. */
      const here = camp.armiesAt(id);
      if (here.length) {
        const list = el("div", { class: "carmies" });
        for (const army of here) {
          const afd = camp.factionDef(army.faction);
          const b = btn(
            "carmy" + (army.id === this.view.selArmy ? " on" : ""),
            t("campaign.army.chip", {
              house: afd ? ZS.i18n.t(afd.house) : "?",
              n: ZS.i18n.nc(army.troops),
            }),
            () => this.view.selectArmy(army.id),
          );
          b.insertBefore(swatch(afd), b.firstChild);
          list.appendChild(b);
        }
        box.appendChild(list);
      }

      if (mine) {
        /* Muster: how many, then the two verbs. Full width, priced, and above
           the numbers — this is the order a player actually gives on their own
           ground, so it is the first thing under the title. */
        const cap = Math.max(0, camp.recruitCap(id));
        const num = el("input", {
          type: "number",
          class: "cnum",
          min: "0",
          step: "100",
          max: String(cap),
          value: String(Math.min(500, cap)),
          id: "camp-men",
          "aria-label": t("campaign.recruit.men"),
        });
        box.appendChild(el("div", { class: "clabel", text: t("campaign.orders") }));
        box.appendChild(
          el("div", { class: "cmuster" }, [
            num,
            el("span", { class: "cmuster-cap", text: t("campaign.recruit.cap", { n: cap }) }),
          ]),
        );
        const acts = el("div", { class: "cacts" }, [
          btn("cact", t("campaign.recruit.do"), () => {
            const res = ZS.Turn.recruit(camp, id, num.valueAsNumber | 0);
            this.notify(res, "campaign.msg.recruited", { n: num.valueAsNumber | 0 });
          }),
          btn("cact primary", t("campaign.raise.do"), () => {
            const res = ZS.Turn.raise(camp, id, num.valueAsNumber | 0, null);
            if (res.ok) this.view.selectArmy(res.army.id);
            this.notify(res, "campaign.msg.raised", { n: num.valueAsNumber | 0 });
          }),
        ]);
        box.appendChild(acts);

        /* Develop — one button per track, priced, disabled at the cap, with
           the level drawn as pips so "how far along am I" is a glance. */
        box.appendChild(el("div", { class: "clabel", text: t("campaign.dev.title") }));
        const dev = el("div", { class: "cdev" });
        for (const track of ZS.Campaign.DEV_TRACKS) {
          const lvl = pr.dev[track] | 0;
          const max = ZS.Campaign.DEV_MAX[track];
          const cost = camp.devCost(id, track);
          const capped = !isFinite(cost);
          const b = el("button", { class: "cact dev", "data-dev": track }, [
            el("span", { class: "d-name", text: t("campaign.dev." + track) }),
            pips(lvl, max),
            el("span", {
              class: "d-cost",
              text: capped ? t("campaign.dev.capped") : t("campaign.dev.cost", { n: cost }),
            }),
          ]);
          b.addEventListener("click", () => {
            const res = ZS.Turn.develop(camp, id, track);
            this.notify(res, "campaign.msg.developed", { track: t("campaign.dev." + track) });
          });
          if (capped || camp.player().gold < cost) b.disabled = true;
          dev.appendChild(b);
        }
        box.appendChild(dev);
      }

      /* The numbers, under the orders, two to a line. */
      const specialty = ZS.CampaignLogistics ? ZS.CampaignLogistics.specialty(pd) : null;
      const pairs = [
        [t("campaign.prov.garrison"), ZS.i18n.n(pr.garrison)],
        [t("campaign.prov.loyalty"), pr.loyalty + "%"],
      ];
      if (mine) {
        pairs.push([t("campaign.prov.income"), ZS.i18n.n(camp.income(id))]);
        pairs.push([t("campaign.prov.food"), ZS.i18n.n(camp.foodYield(id))]);
        pairs.push([t("campaign.prov.cap"), ZS.i18n.n(camp.recruitCap(id))]);
      }
      if (specialty) pairs.push([t("campaign.prov.specialty"), ZS.i18n.t(specialty.name)]);
      box.appendChild(facts(pairs));
      if (specialty) {
        box.appendChild(el("p", { class: "faint", text: ZS.i18n.t(specialty.description) }));
      }
      if (pr.owner) {
        box.appendChild(
          row(
            t("campaign.prov.governor"),
            pr.governor ? ZS.Roster.line(pr.governor) : t("campaign.general.none"),
          ),
        );
      }

      if (!mine) return box;

      /* Appoint a governor from whoever is not already leading a stack or
         minding another seat. Hidden entirely when no almanac is loaded —
         a list of stand-ins would be worse than no list. */
      const free = this.idleGenerals(camp);
      if (ZS.Roster.available() && (free.length || pr.governor)) {
        const seats = el("div", { class: "cgrid" });
        if (pr.governor) {
          seats.appendChild(
            btn(
              "cchip on",
              t("campaign.general.dismiss", { name: ZS.Roster.name(pr.governor) }),
              () => {
                const res = ZS.Turn.assign(camp, pr.governor, null);
                this.notify(res, "campaign.msg.dismissed");
              },
            ),
          );
        }
        for (const gid of free.slice(0, 8)) {
          seats.appendChild(
            btn("cchip", ZS.Roster.line(gid), () => {
              const res = ZS.Turn.assign(camp, gid, { govern: id });
              this.notify(res, "campaign.msg.appointed", { name: ZS.Roster.name(gid) });
            }),
          );
        }
        box.appendChild(el("div", { class: "clabel", text: t("campaign.prov.appoint") }));
        box.appendChild(seats);
      }
      return box;
    },

    armyBlock(camp, a) {
      const t = (k, p) => ZS.i18n.t(k, p);
      const mine = a.faction === camp.playerFactionId;
      const box = el("section", {
        class: "cblock army" + (mine ? " held" : ""),
        "data-army": a.id,
      });
      const fd = camp.factionDef(a.faction);
      box.appendChild(
        el("h3", { class: "ctitle" }, [
          swatch(fd),
          el("span", { text: t("campaign.army.title", { house: fd ? ZS.i18n.t(fd.house) : "?" }) }),
        ]),
      );
      /* The one instruction that matters while a stack is in hand, said where
         the player is already looking. */
      if (mine) {
        box.appendChild(el("div", { class: "cbanner", text: t("campaign.guide.army") }));
      }

      if (ZS.Army.isMarching(a)) {
        const dest = ZS.CampaignMap.province(a.path[a.path.length - 1]);
        box.appendChild(
          el("div", {
            class: "csub",
            text: t("campaign.army.marchTo", {
              place: dest ? ZS.i18n.t(dest.name) : "?",
              turns:
                a.left +
                ZS.CampaignMap.pathCost([a.at].concat(a.path)) -
                ZS.CampaignMap.cost(a.at, a.path[0]),
            }),
          }),
        );
      }

      const men = ZS.Army.men(a);
      box.appendChild(
        facts([
          [t("campaign.army.troops"), ZS.i18n.n(a.troops)],
          [t("campaign.army.strength"), ZS.i18n.n(ZS.Army.strength(a))],
          [t("campaign.army.fatigue"), Math.round(a.fatigue * 100) + "%"],
          [
            t("campaign.army.supply"),
            a.supply
              ? t("campaign.army.supply." + a.supply) +
                (a.supplyDistance >= 0
                  ? " · " + t("campaign.army.supplyDistance", { n: a.supplyDistance })
                  : "")
              : null,
          ],
        ]),
      );
      box.appendChild(
        row(
          t("campaign.army.comp"),
          ZS.Army.ARMS.map((k) => t("battle.type." + k) + " " + ZS.i18n.nc(men[k])).join(" · "),
        ),
      );

      if (a.generals.length) {
        box.appendChild(el("div", { class: "clabel", text: t("campaign.army.generals") }));
        for (const gid of a.generals) {
          box.appendChild(row(ZS.Roster.name(gid), generalSummary(camp, gid), "gen"));
        }
      }

      if (!mine) return box;
      const acts = el("div", { class: "cacts" }, [
        btn("cact", t("campaign.army.halt"), () => {
          const res = ZS.Turn.halt(camp, a.id);
          this.notify(res, "campaign.msg.halted");
        }),
        btn("cact", t("campaign.army.disband"), () => {
          const res = ZS.Turn.disband(camp, a.id);
          if (res.ok) this.view.selArmy = null;
          this.notify(res, "campaign.msg.disbanded");
        }),
      ]);
      box.appendChild(acts);

      /* Assign / release. Three is the cap (§4.1), and a general is in exactly
         one place — the order layer enforces both, this just offers them. */
      if (ZS.Roster.available()) {
        const chips = el("div", { class: "cgrid" });
        for (const gid of a.generals) {
          chips.appendChild(
            btn("cchip on", t("campaign.general.release", { name: ZS.Roster.name(gid) }), () => {
              const res = ZS.Turn.assign(camp, gid, null);
              this.notify(res, "campaign.msg.released", { name: ZS.Roster.name(gid) });
            }),
          );
        }
        if (a.generals.length < ZS.Army.MAX_GENERALS) {
          for (const gid of this.idleGenerals(camp).slice(0, 8)) {
            chips.appendChild(
              btn("cchip", ZS.Roster.line(gid), () => {
                const res = ZS.Turn.assign(camp, gid, { army: a.id });
                this.notify(res, "campaign.msg.assigned", { name: ZS.Roster.name(gid) });
              }),
            );
          }
        }
        if (chips.childNodes.length) {
          box.appendChild(el("div", { class: "clabel", text: t("campaign.army.assign") }));
          box.appendChild(chips);
        }
      }
      return box;
    },

    /* The player's officers who are neither leading a stack nor holding a
       seat — the pool every Assign order draws from. */
    idleGenerals(camp) {
      const f = camp.player();
      if (!f) return [];
      return f.generals.filter((gid) => !camp.isBusy(gid, null));
    },

    /* ---- the turn --------------------------------------------------------- */

    endTurn() {
      const camp = this.view && this.view.camp;
      if (!camp || camp.over) return;
      /* The halo says "the board is waiting on you". From here it is not, so
         it stops breathing until the season comes back. */
      this.view.playerTurn = false;
      this.view.selArmy = null;
      this.view._plan = null;
      this.hideTip();
      this.drawGuide();
      if (ZS.CampaignEvents) {
        const tale = ZS.CampaignEvents.pending(camp);
        if (tale) {
          this.showEvent(tale);
          return;
        }
      }
      const outcome =
        !ZS.App.settings.autoResolveDefault && ZS.Turn.begin
          ? ZS.Turn.begin(camp, { interactive: true })
          : ZS.Turn.end(camp);
      this.resumeTurn(outcome);
    },

    /* A season can return here several times: once for each player battle,
       then once more when AI/world resolution is complete. Nothing autosaves
       until that final return. */
    resumeTurn(outcome) {
      const camp = this.view && this.view.camp;
      if (!camp || !outcome) return;
      const pending = outcome.pending || (outcome.setup ? outcome : null);
      if (pending) {
        /* A battle to answer is still the board waiting on the player, so the
           halo comes back on for the decision. */
        this.view.playerTurn = true;
        this.drawGuide();
        this.showEncounter(pending);
        return;
      }
      this.encounter.classList.remove("on");
      this.finishTurn(outcome.report || outcome);
    },

    showEncounter(context) {
      const camp = this.view && this.view.camp;
      if (!camp || !context) return;
      const t = (k, p) => ZS.i18n.t(k, p);
      const setup = context.setup || {};
      const field = setup.field || {};
      const pd = ZS.CampaignMap.province(context.province || field.provinceId);
      const place = pd ? ZS.i18n.t(pd.name) : context.province || "?";
      const kind = field.kind || context.kind || "open";
      const side0 = setup.sides && setup.sides[0];
      const side1 = setup.sides && setup.sides[1];
      this.encounter.textContent = "";
      this.encounter.appendChild(el("h2", { text: t("campaign.battle.title", { place }) }));
      this.encounter.appendChild(
        el("p", {
          text: t("campaign.battle.summary", {
            kind: t("campaign.battle.kind." + kind),
            biome: t("campaign.battle.biome." + (field.biome || "plain")),
            layout: t("campaign.battle.layout." + (field.layout || "broad_plain")),
            own: ZS.i18n.n(side0 ? side0.onField + side0.reserve : 0),
            foe: ZS.i18n.n(side1 ? side1.onField + side1.reserve : 0),
          }),
        }),
      );
      const actions = el("div", { class: "enc-actions" }, [
        btn("mbtn primary", t("campaign.battle.play"), () => {
          this.encounter.classList.remove("on");
          ZS.App.go("battle", { setup, context });
        }),
        btn("mbtn", t("campaign.battle.auto"), () => {
          this.resumeTurn(ZS.Turn.autoPending(camp));
        }),
        btn("mbtn", t("campaign.battle.retreat"), () => {
          this.resumeTurn(ZS.Turn.retreatPending(camp));
        }),
      ]);
      this.encounter.appendChild(actions);
      this.encounter.classList.add("on");
      if (this.endBtn) this.endBtn.disabled = true;
    },

    finishTurn(rep) {
      const camp = this.view && this.view.camp;
      if (!camp || !rep) return;
      /* The selection may have marched, died or been disbanded under us. */
      if (this.view.selArmy && !camp.armies[this.view.selArmy]) this.view.selArmy = null;
      if (this.endBtn) this.endBtn.disabled = false;
      this.view.playerTurn = true;
      this.refresh();
      this.showReport(rep);
      /* §5.4: the autosave fires at the end of a World phase, which is exactly
         here — never mid-resolve. */
      ZS.SaveManager.autosave(true).then((okSave) => {
        if (!okSave && ZS.UI) ZS.UI.say(ZS.i18n.t("err.saveFailed", { code: "auto" }), 4000);
      });
      if (camp.over) this.showOver(camp.over);
      else if (ZS.CampaignEvents) {
        const tale = ZS.CampaignEvents.pending(camp);
        if (tale) this.showEvent(tale);
      }
    },

    /* RTK-style Tales are explicit decisions, never invisible turn modifiers.
       The same modal as an encounter keeps the player in the paper-map flow,
       while the queued content id means reloading cannot dodge the choice. */
    showEvent(pending) {
      const camp = this.view && this.view.camp;
      if (!camp || !pending || !pending.event || !ZS.CampaignEvents) return;
      const event = pending.event;
      const place = ZS.CampaignEvents.contextName(camp, pending.record);
      this.encounter.textContent = "";
      this.encounter.appendChild(el("h2", { text: ZS.i18n.t(event.title) }));
      if (place) {
        this.encounter.appendChild(
          el("div", {
            class: "rep-title",
            text: ZS.i18n.t("campaign.event.at", { place }),
          }),
        );
      }
      this.encounter.appendChild(el("p", { text: ZS.i18n.t(event.body) }));
      const actions = el("div", { class: "enc-actions" });
      for (let i = 0; i < event.choices.length; i++) {
        const choice = event.choices[i];
        const b = btn(
          i === 0 ? "mbtn primary" : "mbtn",
          ZS.i18n.t("campaign.event.choice", {
            choice: ZS.i18n.t(choice.label),
            effect: ZS.i18n.t(choice.hint),
          }),
          () => {
            const result = ZS.CampaignEvents.choose(camp, i);
            if (!result.ok) {
              if (ZS.UI) ZS.UI.say(ZS.i18n.t(result.err), 3000);
              return;
            }
            this.refresh();
            const next = ZS.CampaignEvents.pending(camp);
            if (next) this.showEvent(next);
            else {
              this.encounter.classList.remove("on");
              if (this.endBtn) this.endBtn.disabled = false;
            }
            ZS.SaveManager.autosave(true).then(() => {});
          },
          { "data-event-choice": i },
        );
        b.disabled = !ZS.CampaignEvents.canChoose(camp, i);
        actions.appendChild(b);
      }
      this.encounter.appendChild(actions);
      this.encounter.classList.add("on");
      if (this.endBtn) this.endBtn.disabled = true;
    },

    showRoster() {
      const camp = this.view && this.view.camp;
      const faction = camp && camp.player();
      if (!camp || !faction || !ZS.General) return;
      const t = (k, p) => ZS.i18n.t(k, p);
      camp.syncGeneralLocations();
      this.encounter.textContent = "";
      this.encounter.appendChild(el("h2", { text: t("campaign.roster.title") }));
      const list = el("div", { class: "pick-list" });
      const ids = faction.generals.slice().sort((a, b) => {
        const ga = camp.general(a),
          gb = camp.general(b);
        return gb.level - ga.level || gb.loyalty - ga.loyalty || a.localeCompare(b);
      });
      for (const id of ids) {
        const general = camp.general(id);
        if (!general || general.dead || general.capturedBy) continue;
        const stats = ZS.General.derive(general);
        const card = el("section", { class: "cblock", "data-general": id });
        card.appendChild(
          el("h3", {
            class: "ctitle",
            text: t("campaign.roster.nameLevel", {
              name: ZS.Roster.name(id),
              level: general.level,
            }),
          }),
        );
        card.appendChild(
          el("div", {
            class: "csub",
            text: t("campaign.roster.stats", {
              wu: stats.wu,
              tong: stats.tong,
              zhi: stats.zhi,
              zheng: stats.zheng,
            }),
          }),
        );
        card.appendChild(
          row(
            t("campaign.roster.progress"),
            t("campaign.roster.progressValue", {
              xp: general.xp,
              next: ZS.General.xpToNext(general.level),
            }),
          ),
        );
        card.appendChild(row(t("campaign.roster.loyalty"), general.loyalty + "%"));
        card.appendChild(row(t("campaign.roster.location"), generalLocationText(camp, general)));
        card.appendChild(
          row(
            t("campaign.roster.injury"),
            t("campaign.injury." + general.injury, { turns: general.injuryT | 0 }),
          ),
        );
        if (general.skillIds.length) {
          const names = general.skillIds.map((skillId) => {
            const skill = ZS.GeneralSkills.get(skillId);
            return skill ? ZS.i18n.t(skill.name) : skillId;
          });
          card.appendChild(row(t("campaign.roster.skills"), names.join(" · ")));
        }
        if (general.itemIds.length) {
          card.appendChild(
            row(
              t("campaign.roster.items"),
              t("campaign.roster.itemCount", { n: general.itemIds.length }),
            ),
          );
        }
        if (general.injury !== "none") {
          const rest = btn("cchip", t("campaign.roster.rest"), () => {
            const result = ZS.Turn.rest(camp, id);
            this.notify(result, "campaign.msg.rested", { name: ZS.Roster.name(id) });
            if (result.ok) this.showRoster();
          });
          rest.disabled = !canRestGeneral(camp, general) || faction.food < ZS.Turn.REST_FOOD;
          card.appendChild(rest);
        }
        list.appendChild(card);
      }
      const prisoners = Object.values(camp.generals)
        .filter((general) => general && !general.dead && general.capturedBy === faction.id)
        .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
      if (prisoners.length) {
        list.appendChild(el("h3", { class: "ctitle", text: t("campaign.roster.prisoners") }));
        for (const general of prisoners) {
          const stats = ZS.General.derive(general);
          const card = el("section", {
            class: "cblock",
            "data-prisoner": general.id,
          });
          card.appendChild(
            el("h3", {
              class: "ctitle",
              text: t("campaign.roster.captiveName", {
                name: ZS.Roster.name(general.id),
                level: general.level,
                loyalty: general.loyalty,
              }),
            }),
          );
          card.appendChild(
            el("div", {
              class: "csub",
              text: t("campaign.roster.stats", {
                wu: stats.wu,
                tong: stats.tong,
                zhi: stats.zhi,
                zheng: stats.zheng,
              }),
            }),
          );
          const actions = el("div", { class: "enc-actions" }, [
            btn("cchip", t("campaign.roster.recruitPrisoner"), () => {
              if (camp.recruitCaptured(general.id, faction.id)) {
                if (ZS.UI) {
                  ZS.UI.say(
                    t("campaign.msg.prisonerRecruited", { name: ZS.Roster.name(general.id) }),
                  );
                }
                this.showRoster();
              }
            }),
            btn("cchip", t("campaign.roster.releasePrisoner"), () => {
              if (camp.releaseGeneral(general.id)) this.showRoster();
            }),
            btn("cchip", t("campaign.roster.executePrisoner"), () => {
              if (camp.executeCaptured(general.id, faction.id)) this.showRoster();
            }),
          ]);
          card.appendChild(actions);
          list.appendChild(card);
        }
      }
      this.encounter.appendChild(list);
      this.encounter.appendChild(
        btn("mbtn", t("campaign.roster.close"), () => {
          this.encounter.classList.remove("on");
          if (this.endBtn) this.endBtn.disabled = false;
        }),
      );
      this.encounter.classList.add("on");
      if (this.endBtn) this.endBtn.disabled = true;
    },

    showReport(rep) {
      if (!rep) {
        this.report.classList.remove("on");
        return;
      }
      const t = (k, p) => ZS.i18n.t(k, p);
      const camp = this.view.camp;
      this.report.textContent = "";
      const lines = [];
      for (const b of rep.battles) {
        const pd = ZS.CampaignMap.province(b.province);
        const wf = camp.factionDef(b.winner);
        lines.push(
          t("campaign.log.battle", {
            province: pd ? ZS.i18n.t(pd.name) : b.province,
            winner: wf ? ZS.i18n.t(wf.name) : t("battle.draw"),
            dead: ZS.i18n.n(sum(b.losses)),
          }),
        );
        for (const duel of b.duelLog || []) {
          lines.push(
            t("campaign.log.duel." + duel.outcome, {
              winner: ZS.Roster.name(duel.winner),
              loser: ZS.Roster.name(duel.loser),
              a: duel.scoreA,
              b: duel.scoreB,
            }),
          );
        }
        for (const general of b.generals || []) {
          if (!general || (!general.xpGained && general.outcome === "ok")) continue;
          lines.push(
            t("campaign.log.general." + (general.outcome || "ok"), {
              general: ZS.Roster.name(general.id),
              xp: general.xpGained | 0,
            }),
          );
        }
      }
      for (const cpt of rep.captured) {
        const pd = ZS.CampaignMap.province(cpt.province);
        const to = camp.factionDef(cpt.to);
        lines.push(
          t("campaign.log.captured", {
            province: pd ? ZS.i18n.t(pd.name) : cpt.province,
            faction: to ? ZS.i18n.t(to.name) : cpt.to,
          }),
        );
      }
      for (const fid of rep.starved) {
        const f = camp.factionDef(fid);
        lines.push(t("campaign.log.starving", { faction: f ? ZS.i18n.t(f.name) : fid }));
      }
      for (const supply of rep.supply || []) {
        const army = camp.armies[supply.army];
        if (army && army.faction !== camp.playerFactionId) continue;
        lines.push(
          t("campaign.log.supply." + supply.state, {
            army: supply.army,
            lost: ZS.i18n.n(supply.lost || 0),
          }),
        );
      }
      if (rep.generalNews) {
        for (const id of rep.generalNews.healed || []) {
          if (camp.general(id) && camp.general(id).allegiance === camp.playerFactionId) {
            lines.push(t("campaign.log.healed", { general: ZS.Roster.name(id) }));
          }
        }
        for (const news of rep.generalNews.defected || []) {
          if (news.from !== camp.playerFactionId && news.to !== camp.playerFactionId) continue;
          const from = camp.factionDef(news.from),
            to = camp.factionDef(news.to);
          lines.push(
            t("campaign.log.defected", {
              general: ZS.Roster.name(news.id),
              from: from ? ZS.i18n.t(from.name) : news.from,
              to: to ? ZS.i18n.t(to.name) : news.to,
            }),
          );
        }
      }
      if (!lines.length) lines.push(t("campaign.log.quiet"));
      this.report.appendChild(el("div", { class: "rep-title", text: camp.dateText() }));
      for (const line of lines.slice(-10)) {
        this.report.appendChild(el("div", { class: "rep-line", text: line }));
      }
      this.report.classList.add("on");
    },

    showOver(over) {
      const camp = this.view.camp;
      const won = over.winner === camp.playerFactionId;
      const t = (key, params) => ZS.i18n.t(key, params);
      const progress = ZS.CampaignVictory
        ? ZS.CampaignVictory.progress(camp, camp.playerFactionId, camp.goal)
        : null;
      this.encounter.textContent = "";
      this.encounter.appendChild(
        el("h2", { text: t(won ? "campaign.over.title.win" : "campaign.over.title.lose") }),
      );
      this.encounter.appendChild(
        el("p", {
          text: t(won ? "campaign.over.body.win" : "campaign.over.body.lose", {
            date: camp.dateText(),
            held: progress ? progress.held : 0,
            total: progress ? progress.total : 0,
          }),
        }),
      );
      this.encounter.appendChild(
        el("div", { class: "enc-actions" }, [
          btn("mbtn primary", t("campaign.over.review"), () => {
            this.encounter.classList.remove("on");
          }),
          btn("mbtn", t("campaign.over.menu"), () => ZS.App.go("menu")),
        ]),
      );
      this.encounter.classList.add("on");
      if (this.endBtn) this.endBtn.disabled = true;
    },

    /* ---- messages ---------------------------------------------------------- */

    /* One place that turns an order result into a line of feedback. `ok` uses
       the caller's key; a refusal uses the error key ZS.Turn returned, so a new
       failure mode shows up as text rather than as silence. */
    notify(res, okKey, params) {
      this.refresh();
      if (!ZS.UI) return res;
      if (res.ok) ZS.UI.say(ZS.i18n.t(okKey, params));
      else ZS.UI.say(ZS.i18n.t(res.err, res.params || {}), 3200);
      return res;
    },
  };

  function generalSummary(camp, gid) {
    const general = camp.general && camp.general(gid);
    const st = ZS.Roster.stats(gid, camp);
    if (!general) return st.wu + " / " + st.tong + " / " + st.zhi + " / " + st.zheng;
    return ZS.i18n.t("campaign.general.summary", {
      level: general.level,
      loyalty: general.loyalty,
      injury: ZS.i18n.t("campaign.injury." + general.injury, { turns: general.injuryT | 0 }),
    });
  }

  function canRestGeneral(camp, general) {
    let location = general.location;
    if (location && location.startsWith("army:")) {
      const army = camp.armies[location.slice(5)];
      if (!army || ZS.Army.isMarching(army)) return false;
      location = army.at;
    }
    return !!(location && camp.prov(location) && camp.owner(location) === general.allegiance);
  }

  function generalLocationText(camp, general) {
    let location = general.location || "free";
    if (location.startsWith("army:")) {
      const army = camp.armies[location.slice(5)];
      const province = army && ZS.CampaignMap.province(army.at);
      return ZS.i18n.t("campaign.location.army", {
        place: province ? ZS.i18n.t(province.name) : "?",
      });
    }
    const province = ZS.CampaignMap.province(location);
    if (province) return ZS.i18n.t(province.name);
    return ZS.i18n.t("campaign.location." + location);
  }

  function sum(losses) {
    let n = 0;
    for (const k in losses) n += losses[k];
    return n;
  }

  ZS.CampaignUI = UI;
})();
