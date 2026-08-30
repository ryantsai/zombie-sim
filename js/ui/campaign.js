/* ZS.CampaignUI — the campaign's DOM overlay (docs/SANGUO-DESIGN.md §2, §4.1).

   The canvas owns the map; this owns everything you press. Three pieces:

     the bar     date, treasury, holdings, and End Turn
     the panel   whatever is selected — a province or a stack — and its orders
     the report  what happened while the season turned

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

  const UI = {
    view: null,
    root: null,
    bar: null,
    panel: null,
    report: null,
    pick: null,
    built: false,

    build() {
      if (this.built) return this;
      this.root = document.getElementById("ui");

      this.bar = el("div", { id: "camp-bar", class: "camp-bar" });
      this.panel = el("aside", { id: "camp-panel", class: "camp-panel" });
      this.report = el("div", { id: "camp-report", class: "camp-report" });
      this.pick = el("div", { id: "camp-pick", class: "panel camp-pick" });
      for (const n of [this.bar, this.panel, this.report, this.pick]) this.root.appendChild(n);

      ZS.i18n.onChange(() => {
        if (this.pick.classList.contains("on")) this.showPick();
        if (this.view) this.refresh();
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
      this.panel.classList.add("on");
      this.refresh();
      this.showReport(null);
    },

    onExit() {
      this.view = null;
      if (!this.root) return;
      this.root.classList.remove("in-campaign");
      this.bar.classList.remove("on");
      this.panel.classList.remove("on");
      this.report.classList.remove("on");
    },

    /* ---- the bar --------------------------------------------------------- */

    refresh() {
      if (!this.view || !this.view.camp) return;
      this.drawBar();
      this.drawPanel();
    },

    drawBar() {
      const camp = this.view.camp;
      const f = camp.player();
      const fd = camp.factionDef(camp.playerFactionId);
      const t = (k, p) => ZS.i18n.t(k, p);
      this.bar.textContent = "";
      this.bar.appendChild(el("span", { class: "cb-date", text: camp.dateText() }));
      this.bar.appendChild(el("span", { class: "cb-faction", text: fd ? ZS.i18n.t(fd.name) : "" }));
      if (f) {
        this.bar.appendChild(
          el("span", { class: "cb-stat", text: t("campaign.bar.gold", { n: ZS.i18n.n(f.gold) }) }),
        );
        this.bar.appendChild(
          el("span", { class: "cb-stat", text: t("campaign.bar.food", { n: ZS.i18n.n(f.food) }) }),
        );
        this.bar.appendChild(
          el("span", {
            class: "cb-stat",
            text: t("campaign.bar.provinces", { n: camp.provincesOf(camp.playerFactionId).length }),
          }),
        );
        this.bar.appendChild(
          el("span", {
            class: "cb-stat",
            text: t("campaign.bar.troops", { n: ZS.i18n.nc(camp.troopsOf(camp.playerFactionId)) }),
          }),
        );
      }
      this.endBtn = btn("mbtn small", t("campaign.endTurn"), () => this.endTurn(), {
        id: "btn-end-turn",
      });
      this.bar.appendChild(this.endBtn);
      this.bar.appendChild(
        btn("mbtn small", t("campaign.quit"), () => ZS.App.go("menu"), { id: "btn-quit-campaign" }),
      );
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

      box.appendChild(el("h3", { class: "ctitle", text: ZS.i18n.t(pd.name) }));
      box.appendChild(
        el("div", {
          class: "csub",
          text: t("campaign.prov.sub", {
            region: ZS.i18n.t(ZS.data.regions[pd.region].name),
            owner: owner ? ZS.i18n.t(owner.name) : t("campaign.prov.unheld"),
          }),
        }),
      );
      box.appendChild(row(t("campaign.prov.garrison"), ZS.i18n.n(pr.garrison)));
      box.appendChild(row(t("campaign.prov.loyalty"), pr.loyalty + "%"));
      if (mine) {
        box.appendChild(row(t("campaign.prov.income"), ZS.i18n.n(camp.income(id))));
        box.appendChild(row(t("campaign.prov.food"), ZS.i18n.n(camp.foodYield(id))));
        box.appendChild(row(t("campaign.prov.cap"), ZS.i18n.n(camp.recruitCap(id))));
      }

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
          list.appendChild(b);
        }
        box.appendChild(list);
      }

      if (!mine) return box;

      /* Develop — one button per track, priced, disabled at the cap. */
      const dev = el("div", { class: "cgrid" });
      for (const track of ZS.Campaign.DEV_TRACKS) {
        const lvl = pr.dev[track] | 0;
        const cost = camp.devCost(id, track);
        const capped = !isFinite(cost);
        const b = btn(
          "cchip",
          t("campaign.dev." + track) +
            " " +
            lvl +
            "/" +
            ZS.Campaign.DEV_MAX[track] +
            (capped ? "" : " · " + cost),
          () => {
            const res = ZS.Turn.develop(camp, id, track);
            this.notify(res, "campaign.msg.developed", { track: t("campaign.dev." + track) });
          },
          { "data-dev": track },
        );
        if (capped || camp.player().gold < cost) b.disabled = true;
        dev.appendChild(b);
      }
      box.appendChild(el("div", { class: "clabel", text: t("campaign.dev.title") }));
      box.appendChild(dev);

      /* Recruit and raise — a number field plus the verb, so the player says
         how many rather than being given three fixed buttons. */
      const num = el("input", {
        type: "number",
        class: "cnum",
        min: "0",
        step: "100",
        value: String(Math.min(500, Math.max(0, camp.recruitCap(id)))),
        id: "camp-men",
      });
      const acts = el("div", { class: "cgrid" }, [
        btn("cchip", t("campaign.recruit.do"), () => {
          const res = ZS.Turn.recruit(camp, id, num.valueAsNumber | 0);
          this.notify(res, "campaign.msg.recruited", { n: num.valueAsNumber | 0 });
        }),
        btn("cchip", t("campaign.raise.do"), () => {
          const res = ZS.Turn.raise(camp, id, num.valueAsNumber | 0, null);
          if (res.ok) this.view.selectArmy(res.army.id);
          this.notify(res, "campaign.msg.raised", { n: num.valueAsNumber | 0 });
        }),
      ]);
      box.appendChild(el("div", { class: "clabel", text: t("campaign.orders") }));
      box.appendChild(el("div", { class: "crow" }, [num, acts]));
      return box;
    },

    armyBlock(camp, a) {
      const t = (k, p) => ZS.i18n.t(k, p);
      const box = el("section", { class: "cblock", "data-army": a.id });
      const fd = camp.factionDef(a.faction);
      box.appendChild(
        el("h3", {
          class: "ctitle",
          text: t("campaign.army.title", { house: fd ? ZS.i18n.t(fd.house) : "?" }),
        }),
      );
      box.appendChild(row(t("campaign.army.troops"), ZS.i18n.n(a.troops)));
      box.appendChild(row(t("campaign.army.strength"), ZS.i18n.n(ZS.Army.strength(a))));
      box.appendChild(row(t("campaign.army.fatigue"), Math.round(a.fatigue * 100) + "%"));

      const men = ZS.Army.men(a);
      box.appendChild(
        row(
          t("campaign.army.comp"),
          ZS.Army.ARMS.map((k) => t("battle.type." + k) + " " + ZS.i18n.nc(men[k])).join(" · "),
        ),
      );

      if (a.generals.length) {
        box.appendChild(
          row(t("campaign.army.generals"), a.generals.map((g) => ZS.Roster.name(g)).join("、")),
        );
      }

      if (ZS.Army.isMarching(a)) {
        const dest = ZS.CampaignMap.province(a.path[a.path.length - 1]);
        box.appendChild(
          row(
            t("campaign.army.marching"),
            t("campaign.army.marchTo", {
              place: dest ? ZS.i18n.t(dest.name) : "?",
              turns:
                a.left +
                ZS.CampaignMap.pathCost([a.at].concat(a.path)) -
                ZS.CampaignMap.cost(a.at, a.path[0]),
            }),
          ),
        );
      }

      if (a.faction !== camp.playerFactionId) return box;
      const acts = el("div", { class: "cgrid" }, [
        btn("cchip", t("campaign.army.halt"), () => {
          const res = ZS.Turn.halt(camp, a.id);
          this.notify(res, "campaign.msg.halted");
        }),
        btn("cchip", t("campaign.army.disband"), () => {
          const res = ZS.Turn.disband(camp, a.id);
          if (res.ok) this.view.selArmy = null;
          this.notify(res, "campaign.msg.disbanded");
        }),
      ]);
      box.appendChild(el("div", { class: "clabel", text: t("campaign.army.orderHint") }));
      box.appendChild(acts);
      return box;
    },

    /* ---- the turn --------------------------------------------------------- */

    endTurn() {
      const camp = this.view && this.view.camp;
      if (!camp || camp.over) return;
      const rep = ZS.Turn.end(camp);
      /* The selection may have marched, died or been disbanded under us. */
      if (this.view.selArmy && !camp.armies[this.view.selArmy]) this.view.selArmy = null;
      this.refresh();
      this.showReport(rep);
      /* §5.4: the autosave fires at the end of a World phase, which is exactly
         here — never mid-resolve. */
      ZS.SaveManager.autosave(true).then((okSave) => {
        if (!okSave && ZS.UI) ZS.UI.say(ZS.i18n.t("err.saveFailed", { code: "auto" }), 4000);
      });
      if (camp.over) this.showOver(camp.over);
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
      if (!lines.length) lines.push(t("campaign.log.quiet"));
      this.report.appendChild(el("div", { class: "rep-title", text: camp.dateText() }));
      for (const line of lines.slice(-6)) {
        this.report.appendChild(el("div", { class: "rep-line", text: line }));
      }
      this.report.classList.add("on");
    },

    showOver(over) {
      const camp = this.view.camp;
      const won = over.winner === camp.playerFactionId;
      if (ZS.UI) ZS.UI.say(ZS.i18n.t(won ? "campaign.over.win" : "campaign.over.lose"), 8000);
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

  function sum(losses) {
    let n = 0;
    for (const k in losses) n += losses[k];
    return n;
  }

  ZS.CampaignUI = UI;
})();
