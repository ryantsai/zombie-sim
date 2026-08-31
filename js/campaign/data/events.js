/* ZS.data.campaignEvents — bilingual, choice-driven campaign Tales.
 *
 * The event engine owns selection and effects. This file is immutable content:
 * every choice is explicit, previewable, and serializable by id so a pending
 * decision survives a save without copying prose into the snapshot. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const data = (ZS.data = ZS.data || {});

  const t = (zh, en) => ({ "zh-tw": zh, en });

  data.campaignEvents = [
    {
      id: "harvest_surplus",
      scope: "province",
      requires: "any",
      title: t("秋收盈倉", "A Rich Harvest"),
      body: t(
        "田官報稱新穀滿倉。是留糧備戰，還是趁價高出售？",
        "The granaries are full after a generous harvest. Store the grain for war, or sell while prices are high?",
      ),
      choices: [
        {
          label: t("封倉備荒", "Store the grain"),
          hint: t("糧 +450，民忠 +2", "Food +450, loyalty +2"),
          effects: { food: 450, loyalty: 2 },
        },
        {
          label: t("開市糶糧", "Sell at market"),
          hint: t("金 +220，糧 +100", "Gold +220, food +100"),
          effects: { gold: 220, food: 100 },
        },
      ],
    },
    {
      id: "refugee_column",
      scope: "province",
      requires: "any",
      title: t("流民叩關", "Refugees at the Gate"),
      body: t(
        "戰亂中的百姓扶老攜幼，求一塊田與一口糧。",
        "Families displaced by war ask for land and a season of grain.",
      ),
      choices: [
        {
          label: t("開倉安置", "Settle them"),
          hint: t("糧 -180，守軍 +180，民忠 +6", "Food -180, garrison +180, loyalty +6"),
          effects: { food: -180, garrison: 180, loyalty: 6 },
        },
        {
          label: t("閉門拒之", "Bar the gate"),
          hint: t("民忠 -5，動亂 +1", "Loyalty -5, unrest +1"),
          effects: { loyalty: -5, unrest: 1 },
        },
      ],
    },
    {
      id: "frontier_bandits",
      scope: "province",
      requires: "frontier",
      title: t("山賊截道", "Bandits on the Road"),
      body: t(
        "商旅被劫，鄉里盼官軍清道；賊首也暗中送來議和書。",
        "Raiders choke the trade road. The villages ask for soldiers, while the bandit chief quietly offers terms.",
      ),
      choices: [
        {
          label: t("遣兵剿賊", "Send the garrison"),
          hint: t("守軍 -80，民忠 +8，動亂 -1", "Garrison -80, loyalty +8, unrest -1"),
          effects: { garrison: -80, loyalty: 8, unrest: -1 },
        },
        {
          label: t("納金招安", "Buy their service"),
          hint: t("金 -120，守軍 +70", "Gold -120, garrison +70"),
          effects: { gold: -120, garrison: 70 },
        },
      ],
    },
    {
      id: "river_flood",
      scope: "province",
      requires: "river",
      title: t("江河暴漲", "The River Rises"),
      body: t(
        "連日大雨沖毀堤岸。修堤可安百姓，徵收漂糧則能濟軍。",
        "Weeks of rain have broken the levees. Repairing them calms the people; requisitioning washed-up grain feeds the army.",
      ),
      choices: [
        {
          label: t("出金修堤", "Repair the levees"),
          hint: t("金 -180，民忠 +8，動亂 -1", "Gold -180, loyalty +8, unrest -1"),
          effects: { gold: -180, loyalty: 8, unrest: -1 },
        },
        {
          label: t("先濟軍糧", "Requisition supplies"),
          hint: t("糧 +260，民忠 -8，動亂 +1", "Food +260, loyalty -8, unrest +1"),
          effects: { food: 260, loyalty: -8, unrest: 1 },
        },
      ],
    },
    {
      id: "mountain_pass",
      scope: "province",
      requires: "hill",
      title: t("險道新徑", "A Path Through the Hills"),
      body: t(
        "樵夫發現一條可繞過關隘的小徑。可築寨控制，也可派斥候熟記山勢。",
        "Woodcutters have found a path around the pass. Fortify it, or send scouts to learn every turn.",
      ),
      choices: [
        {
          label: t("築寨扼守", "Fortify the path"),
          hint: t("金 -160，城防 +1", "Gold -160, wall development +1"),
          effects: { gold: -160, wall: 1 },
        },
        {
          label: t("遣斥候測道", "Map the route"),
          hint: t("糧 -90，民忠 +4", "Food -90, loyalty +4"),
          effects: { food: -90, loyalty: 4 },
        },
      ],
    },
    {
      id: "merchant_guild",
      scope: "province",
      requires: "any",
      title: t("商賈請券", "The Merchants' Charter"),
      body: t(
        "行商願修市肆與驛站，條件是數年減稅；也可即刻加徵過路金。",
        "A guild offers to rebuild markets and post roads in exchange for a charter. You could instead levy an immediate toll.",
      ),
      choices: [
        {
          label: t("准券興市", "Grant the charter"),
          hint: t("金 -150，商業 +1", "Gold -150, income development +1"),
          effects: { gold: -150, incomeDev: 1 },
        },
        {
          label: t("即徵行稅", "Levy a toll"),
          hint: t("金 +230，民忠 -5", "Gold +230, loyalty -5"),
          effects: { gold: 230, loyalty: -5 },
        },
      ],
    },
    {
      id: "river_merchants",
      scope: "province",
      requires: "port",
      title: t("舟商泊岸", "River Merchants"),
      body: t(
        "舟隊帶來鹽、布與南方稻米。扶植長久商路，或只收今日之稅？",
        "A convoy brings salt, cloth, and southern rice. Fund a lasting route, or collect today's duties?",
      ),
      choices: [
        {
          label: t("護航通商", "Protect the trade"),
          hint: t("金 -120，糧 +260，民忠 +3", "Gold -120, food +260, loyalty +3"),
          effects: { gold: -120, food: 260, loyalty: 3 },
        },
        {
          label: t("重徵舟稅", "Tax the convoy"),
          hint: t("金 +180，民忠 -4", "Gold +180, loyalty -4"),
          effects: { gold: 180, loyalty: -4 },
        },
      ],
    },
    {
      id: "army_drill",
      scope: "army",
      requires: "army",
      title: t("軍中校閱", "The Army Review"),
      body: t(
        "諸將請求整日操演。嚴訓能磨利軍鋒，也可能使遠征之師更加疲憊。",
        "The officers request a full day of drill. Hard training sharpens the host, but burdens a tired army.",
      ),
      choices: [
        {
          label: t("整軍嚴訓", "Drill hard"),
          hint: t("將領經驗 +60，疲勞 +12%", "General XP +60, fatigue +12%"),
          effects: { generalXp: 60, fatigue: 0.12 },
        },
        {
          label: t("休兵養銳", "Rest the host"),
          hint: t("疲勞 -20%", "Fatigue -20%"),
          effects: { fatigue: -0.2 },
        },
      ],
    },
    {
      id: "wounded_counsel",
      scope: "general",
      requires: "wounded",
      title: t("傷將請命", "A Wounded Officer"),
      body: t(
        "傷勢未癒的將領請求回軍效力。是命其靜養，還是准其帶傷出仕？",
        "A wounded officer asks to return to duty before fully healed. Order bed rest, or accept the risk?",
      ),
      choices: [
        {
          label: t("留城靜養", "Order bed rest"),
          hint: t("糧 -100，傷勢恢復，忠誠 +3", "Food -100, injury recovery, loyalty +3"),
          effects: { food: -100, heal: 1, generalLoyalty: 3 },
        },
        {
          label: t("准其請戰", "Return to duty"),
          hint: t("經驗 +70，忠誠 +4，傷期 +1", "XP +70, loyalty +4, recovery +1 turn"),
          effects: { generalXp: 70, generalLoyalty: 4, injuryTurns: 1 },
        },
      ],
    },
    {
      id: "wavering_oath",
      scope: "general",
      requires: "low_loyalty",
      title: t("舊主來書", "A Letter from an Old Lord"),
      body: t(
        "密探截下一封招攬書。這位將領尚未答覆，但其心顯然有所動搖。",
        "Your agents intercept an offer from another lord. The officer has not replied, but their resolve is wavering.",
      ),
      choices: [
        {
          label: t("厚賜安其心", "Reward their service"),
          hint: t("金 -180，忠誠 +20", "Gold -180, loyalty +20"),
          effects: { gold: -180, generalLoyalty: 20 },
        },
        {
          label: t("坦言以待", "Answer with trust"),
          hint: t("忠誠 +6，經驗 +30", "Loyalty +6, XP +30"),
          effects: { generalLoyalty: 6, generalXp: 30 },
        },
      ],
    },
    {
      id: "supply_convoy",
      scope: "army",
      requires: "strained_army",
      title: t("糧道告急", "The Supply Road"),
      body: t(
        "前線糧隊屢遭騷擾。增派護衛可保軍心，催軍就食則能省下眼前糧秣。",
        "Raids threaten the army's supply train. More escorts will steady the host; forced foraging saves stores at the people's expense.",
      ),
      choices: [
        {
          label: t("增派護糧兵", "Escort the convoy"),
          hint: t("糧 -180，疲勞 -15%", "Food -180, fatigue -15%"),
          effects: { food: -180, fatigue: -0.15 },
        },
        {
          label: t("就地徵糧", "Forage locally"),
          hint: t("糧 +120，部隊損失 2%", "Food +120, army loses 2%"),
          effects: { food: 120, armyLossPct: 0.02 },
        },
      ],
    },
    {
      id: "auspicious_omen",
      scope: "province",
      requires: "any",
      title: t("里中祥瑞", "An Auspicious Sign"),
      body: t(
        "鄉人稱夜空有異彩，請主公開宴祭告。亂世之中，一個好兆頭也能安眾心。",
        "Villagers claim a strange light crossed the night sky and ask for a public feast. In troubled times, even a hopeful sign can bind a people.",
      ),
      choices: [
        {
          label: t("設宴同慶", "Hold a feast"),
          hint: t("糧 -140，民忠 +10", "Food -140, loyalty +10"),
          effects: { food: -140, loyalty: 10 },
        },
        {
          label: t("務實不議", "Dismiss the omen"),
          hint: t("民忠 -1", "Loyalty -1"),
          effects: { loyalty: -1 },
        },
      ],
    },
  ];
})();
