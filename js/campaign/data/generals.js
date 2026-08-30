/* ZS.Generals — the first 200-person 火柴三國 general almanac.
 *
 * One compact source row becomes a complete immutable content record with:
 * four §4.1 base stats, level/xp/loyalty defaults, §4.2 skills, equipment,
 * a deterministic portrait recipe, and an always-mounted 1.5x field model.
 * Story-famous figures override the procedural recipe with their familiar
 * Romance / Sangokushi silhouette. Runtime campaign state copies a snapshot;
 * it never mutates this catalogue. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const COLOR = { shu: 0, wu: 1, wei: 2, yuan: 3, other: 4, han: 5, south: 6, jin: 7 };
  const CAPS = ["turban", "helmet", "crown", "band"];
  const BEARDS = ["moustache", "chin", "goatee", "long"];
  const CUES = ["calm", "stern", "bold", "clever", "fierce", "scholarly"];
  const MOUNTS = ["chestnut", "bay", "gray", "black"];

  /* These are the hand-authored hero targets. Their portraits and field
     silhouettes are the reference family; the other records vary within the
     same cap/beard/mount/weapon vocabulary. */
  const ICONIC = {
    liu_bei: ["crown", "chin", "kind", "dual_swords", "hex_mark", "green", "long_ears"],
    guan_yu: ["hood", "long", "stern", "green_dragon", "red_hare", "green", "red_face"],
    zhang_fei: ["turban", "bristle", "angry", "serpent_spear", "black", "black", "round_eyes"],
    zhuge_liang: ["scholar", "goatee", "clever", "feather_fan", "white", "blue", "crane_robe"],
    zhao_yun: ["silver_helmet", "chin", "calm", "dragon_spear", "white", "white", "silver_armor"],
    ma_chao: ["silver_helmet", "moustache", "proud", "spear", "white", "white", "lion_plume"],
    huang_zhong: ["helmet", "long", "aged", "great_bow", "gray", "ochre", "white_brows"],
    pang_tong: ["band", "chin", "wild", "feather_fan", "bay", "brown", "phoenix_scar"],
    wei_yan: ["horn_helmet", "moustache", "fierce", "glaive", "black", "red", "horns"],
    jiang_wei: ["silver_helmet", "chin", "calm", "spear", "white", "blue", "scholar_plume"],
    cao_cao: [
      "crown",
      "moustache",
      "scheming",
      "heaven_sword",
      "shadow_runner",
      "red",
      "narrow_eyes",
    ],
    xiahou_dun: ["helmet", "moustache", "fierce", "spear", "black", "red", "eye_patch"],
    dian_wei: ["helmet", "bristle", "fierce", "twin_halberds", "black", "black", "broad_face"],
    xu_chu: ["turban", "moustache", "fierce", "great_club", "chestnut", "red", "broad_face"],
    zhang_liao: ["helmet", "moustache", "calm", "halberd", "gray", "red", "long_plume"],
    sima_yi: ["crown", "long", "scheming", "feather_fan", "black", "slate", "narrow_eyes"],
    sun_jian: [
      "tiger_helmet",
      "moustache",
      "bold",
      "ancient_sword",
      "chestnut",
      "red",
      "tiger_mark",
    ],
    sun_ce: ["helmet", "moustache", "bold", "overlord_spear", "white", "red", "short_cape"],
    sun_quan: ["crown", "purple", "regal", "sword", "bay", "blue", "jade_eyes"],
    sun_shangxiang: ["phoenix", "none", "bold", "bow_blades", "white", "red", "hair_ribbons"],
    zhou_yu: ["crown", "moustache", "clever", "sword", "white", "blue", "white_cape"],
    lu_meng: ["helmet", "chin", "stern", "glaive", "bay", "blue", "scholar_sash"],
    lu_xun: ["scholar", "chin", "scholarly", "sword", "white", "blue", "scholar_sash"],
    taishi_ci: ["helmet", "moustache", "fierce", "twin_halberds", "gray", "blue", "back_bow"],
    gan_ning: ["band", "moustache", "wild", "chain_blade", "black", "blue", "bells"],
    huang_gai: ["helmet", "long", "aged", "iron_whip", "gray", "blue", "scarred"],
    lv_bu: ["phoenix", "moustache", "wild", "sky_halberd", "red_hare", "violet", "double_plume"],
    dong_zhuo: ["crown", "long", "pompous", "sword", "black", "crimson", "broad_face"],
    diao_chan: ["phoenix", "none", "calm", "ribbon_blades", "white", "violet", "hair_ribbons"],
    yuan_shao: ["ornate_crown", "long", "proud", "sword", "white", "ochre", "gold_tassels"],
    gongsun_zan: ["silver_helmet", "moustache", "stern", "spear", "white", "white", "white_cape"],
    zhang_jue: ["yellow_turban", "long", "wild", "ritual_staff", "gray", "yellow", "forehead_seal"],
    hua_xiong: ["horn_helmet", "bristle", "fierce", "halberd", "black", "crimson", "broad_face"],
    yan_liang: ["helmet", "bristle", "fierce", "great_sabre", "black", "ochre", "red_plume"],
    wen_chou: ["helmet", "moustache", "angry", "spear", "chestnut", "ochre", "blue_plume"],
    meng_huo: ["fur_crown", "bristle", "bold", "great_axe", "black", "brown", "fur_mantle"],
    lady_zhurong: ["feather_crown", "none", "fierce", "flying_blades", "white", "red", "feathers"],
    pan_feng: ["horn_helmet", "bristle", "proud", "great_axe", "chestnut", "ochre", "meme_plume"],
  };

  const LEGENDARY_SKILLS = {
    liu_bei: ["iron_wall", "inspire", "ambush", "disorder"],
    guan_yu: ["valiant", "charge", "inspire", "disorder"],
    zhang_fei: ["valiant", "charge", "inspire", "disorder"],
    zhuge_liang: ["discipline", "fire", "ambush", "disorder"],
    zhao_yun: ["valiant", "charge", "inspire", "ambush"],
    ma_chao: ["swift", "charge", "inspire", "disorder"],
    huang_zhong: ["discipline", "charge", "ambush", "inspire"],
    cao_cao: ["discipline", "ambush", "inspire", "disorder"],
    sima_yi: ["iron_wall", "fire", "ambush", "disorder"],
    sun_jian: ["valiant", "charge", "inspire", "ambush"],
    sun_ce: ["swift", "charge", "inspire", "disorder"],
    sun_quan: ["iron_wall", "inspire", "ambush", "disorder"],
    zhou_yu: ["discipline", "fire", "inspire", "disorder"],
    lv_bu: ["valiant", "charge", "inspire", "disorder"],
    dong_zhuo: ["iron_wall", "charge", "ambush", "disorder"],
    zhang_jue: ["discipline", "fire", "ambush", "disorder"],
    meng_huo: ["iron_wall", "charge", "ambush", "disorder"],
  };

  const ROWS = [
    // Liu Bei / Shu cultural roster (40)
    ["liu_bei", "劉備", "Liu Bei", "玄德", "Xuande", "shu", 75, 90, 76, 85, "lord"],
    ["guan_yu", "關羽", "Guan Yu", "雲長", "Yunchang", "shu", 97, 95, 75, 62, "warrior"],
    ["zhang_fei", "張飛", "Zhang Fei", "翼德", "Yide", "shu", 96, 88, 40, 50, "warrior"],
    [
      "zhuge_liang",
      "諸葛亮",
      "Zhuge Liang",
      "孔明",
      "Kongming",
      "shu",
      38,
      98,
      100,
      96,
      "strategist",
    ],
    ["zhao_yun", "趙雲", "Zhao Yun", "子龍", "Zilong", "shu", 96, 92, 76, 65, "cavalry"],
    ["ma_chao", "馬超", "Ma Chao", "孟起", "Mengqi", "shu", 95, 88, 60, 50, "cavalry"],
    ["huang_zhong", "黃忠", "Huang Zhong", "漢升", "Hansheng", "shu", 92, 80, 60, 55, "archer"],
    ["pang_tong", "龐統", "Pang Tong", "士元", "Shiyuan", "shu", 35, 84, 98, 86, "strategist"],
    ["fa_zheng", "法正", "Fa Zheng", "孝直", "Xiaozhi", "shu", 35, 70, 95, 80, "strategist"],
    ["xu_shu", "徐庶", "Xu Shu", "元直", "Yuanzhi", "shu", 64, 78, 94, 80, "strategist"],
    ["wei_yan", "魏延", "Wei Yan", "文長", "Wenchang", "shu", 92, 87, 68, 45, "warrior"],
    ["jiang_wei", "姜維", "Jiang Wei", "伯約", "Boyue", "shu", 90, 94, 95, 72, "commander"],
    ["liu_shan", "劉禪", "Liu Shan", "公嗣", "Gongsi", "shu", 22, 35, 35, 56, "lord"],
    ["guan_ping", "關平", "Guan Ping", "坦之", "Tanzhi", "shu", 84, 79, 62, 54, "warrior"],
    ["guan_xing", "關興", "Guan Xing", "安國", "Anguo", "shu", 86, 78, 60, 48, "warrior"],
    ["zhang_bao", "張苞", "Zhang Bao", "—", "—", "shu", 87, 77, 52, 42, "warrior"],
    ["ma_dai", "馬岱", "Ma Dai", "伯瞻", "Bozhan", "shu", 84, 80, 66, 55, "cavalry"],
    ["wang_ping", "王平", "Wang Ping", "子均", "Zijun", "shu", 78, 88, 82, 70, "commander"],
    ["ma_su", "馬謖", "Ma Su", "幼常", "Youchang", "shu", 54, 65, 88, 72, "strategist"],
    ["ma_liang", "馬良", "Ma Liang", "季常", "Jichang", "shu", 28, 62, 88, 92, "governor"],
    ["jian_yong", "簡雍", "Jian Yong", "憲和", "Xianhe", "shu", 32, 55, 78, 84, "governor"],
    ["sun_qian", "孫乾", "Sun Qian", "公祐", "Gongyou", "shu", 30, 52, 77, 86, "governor"],
    ["mi_zhu", "糜竺", "Mi Zhu", "子仲", "Zizhong", "shu", 28, 58, 76, 90, "governor"],
    ["mi_fang", "糜芳", "Mi Fang", "子方", "Zifang", "shu", 58, 55, 42, 48, "commander"],
    ["chen_dao", "陳到", "Chen Dao", "叔至", "Shuzhi", "shu", 86, 85, 70, 55, "commander"],
    ["zhou_cang", "周倉", "Zhou Cang", "—", "—", "shu", 88, 72, 38, 35, "warrior"],
    ["liao_hua", "廖化", "Liao Hua", "元儉", "Yuanjian", "shu", 74, 78, 64, 60, "commander"],
    ["liu_feng", "劉封", "Liu Feng", "—", "—", "shu", 82, 75, 55, 46, "warrior"],
    ["meng_da", "孟達", "Meng Da", "子度", "Zidu", "shu", 73, 74, 78, 66, "commander"],
    ["zhang_yi", "張翼", "Zhang Yi", "伯恭", "Bogong", "shu", 76, 82, 72, 68, "commander"],
    ["zhang_ni", "張嶷", "Zhang Ni", "伯岐", "Boqi", "shu", 82, 84, 76, 65, "commander"],
    ["wu_yi", "吳懿", "Wu Yi", "子遠", "Ziyuan", "shu", 79, 82, 70, 68, "commander"],
    ["wu_ban", "吳班", "Wu Ban", "元雄", "Yuanxiong", "shu", 78, 76, 58, 52, "warrior"],
    ["huang_quan", "黃權", "Huang Quan", "公衡", "Gongheng", "shu", 62, 84, 88, 83, "strategist"],
    ["li_yan", "李嚴", "Li Yan", "正方", "Zhengfang", "shu", 78, 82, 78, 76, "commander"],
    ["fei_yi", "費禕", "Fei Yi", "文偉", "Wenwei", "shu", 30, 70, 86, 94, "governor"],
    ["dong_yun", "董允", "Dong Yun", "休昭", "Xiuzhao", "shu", 24, 62, 82, 94, "governor"],
    ["jiang_wan", "蔣琬", "Jiang Wan", "公琰", "Gongyan", "shu", 35, 76, 86, 96, "governor"],
    ["deng_zhi", "鄧芝", "Deng Zhi", "伯苗", "Bomiao", "shu", 62, 74, 82, 88, "governor"],
    ["guan_suo", "關索", "Guan Suo", "—", "—", "shu", 88, 72, 58, 45, "warrior"],

    // Cao / Wei and Jin succession roster (48)
    ["cao_cao", "曹操", "Cao Cao", "孟德", "Mengde", "wei", 78, 96, 96, 92, "lord"],
    ["cao_pi", "曹丕", "Cao Pi", "子桓", "Zihuan", "wei", 70, 83, 84, 88, "lord"],
    ["cao_ren", "曹仁", "Cao Ren", "子孝", "Zixiao", "wei", 86, 94, 72, 65, "commander"],
    ["cao_hong", "曹洪", "Cao Hong", "子廉", "Zilian", "wei", 82, 78, 48, 52, "cavalry"],
    ["cao_zhang", "曹彰", "Cao Zhang", "子文", "Ziwen", "wei", 91, 82, 54, 48, "warrior"],
    ["cao_zhi", "曹植", "Cao Zhi", "子建", "Zijian", "wei", 22, 42, 82, 76, "scholar"],
    ["cao_zhen", "曹真", "Cao Zhen", "子丹", "Zidan", "wei", 84, 90, 76, 72, "commander"],
    ["cao_xiu", "曹休", "Cao Xiu", "文烈", "Wenlie", "wei", 82, 84, 70, 66, "commander"],
    ["cao_chun", "曹純", "Cao Chun", "子和", "Zihe", "wei", 86, 88, 70, 55, "cavalry"],
    ["cao_shuang", "曹爽", "Cao Shuang", "昭伯", "Zhaobo", "wei", 48, 60, 58, 72, "lord"],
    ["xiahou_dun", "夏侯惇", "Xiahou Dun", "元讓", "Yuanrang", "wei", 92, 90, 55, 70, "commander"],
    ["xiahou_yuan", "夏侯淵", "Xiahou Yuan", "妙才", "Miaocai", "wei", 90, 88, 60, 60, "cavalry"],
    ["xiahou_ba", "夏侯霸", "Xiahou Ba", "仲權", "Zhongquan", "wei", 84, 82, 68, 62, "cavalry"],
    ["xiahou_shang", "夏侯尚", "Xiahou Shang", "伯仁", "Boren", "wei", 78, 80, 72, 74, "commander"],
    ["dian_wei", "典韋", "Dian Wei", "君明", "Junming", "wei", 98, 80, 30, 30, "warrior"],
    ["xu_chu", "許褚", "Xu Chu", "仲康", "Zhongkang", "wei", 96, 80, 30, 40, "warrior"],
    ["zhang_liao", "張遼", "Zhang Liao", "文遠", "Wenyuan", "wei", 94, 92, 75, 65, "commander"],
    ["yue_jin", "樂進", "Yue Jin", "文謙", "Wenqian", "wei", 88, 85, 58, 55, "warrior"],
    ["yu_jin", "于禁", "Yu Jin", "文則", "Wenze", "wei", 80, 89, 72, 65, "commander"],
    ["xu_huang", "徐晃", "Xu Huang", "公明", "Gongming", "wei", 92, 91, 74, 62, "commander"],
    ["zhang_he", "張郃", "Zhang He", "儁乂", "Junyi", "wei", 90, 92, 82, 68, "commander"],
    ["li_dian", "李典", "Li Dian", "曼成", "Mancheng", "wei", 79, 82, 84, 74, "commander"],
    ["pang_de", "龐德", "Pang De", "令明", "Lingming", "wei", 94, 84, 62, 48, "warrior"],
    ["guo_jia", "郭嘉", "Guo Jia", "奉孝", "Fengxiao", "wei", 22, 75, 98, 86, "strategist"],
    ["xun_yu", "荀彧", "Xun Yu", "文若", "Wenruo", "wei", 18, 72, 96, 98, "governor"],
    ["xun_you", "荀攸", "Xun You", "公達", "Gongda", "wei", 26, 78, 95, 90, "strategist"],
    ["jia_xu", "賈詡", "Jia Xu", "文和", "Wenhe", "wei", 30, 78, 98, 88, "strategist"],
    ["cheng_yu", "程昱", "Cheng Yu", "仲德", "Zhongde", "wei", 48, 80, 94, 86, "strategist"],
    ["sima_yi", "司馬懿", "Sima Yi", "仲達", "Zhongda", "jin", 70, 94, 98, 92, "strategist"],
    ["sima_shi", "司馬師", "Sima Shi", "子元", "Ziyuan", "jin", 72, 88, 92, 88, "lord"],
    ["sima_zhao", "司馬昭", "Sima Zhao", "子上", "Zishang", "jin", 74, 90, 92, 90, "lord"],
    ["deng_ai", "鄧艾", "Deng Ai", "士載", "Shizai", "jin", 87, 94, 94, 84, "commander"],
    ["zhong_hui", "鍾會", "Zhong Hui", "士季", "Shiji", "jin", 62, 86, 96, 82, "strategist"],
    ["guo_huai", "郭淮", "Guo Huai", "伯濟", "Boji", "wei", 78, 88, 82, 72, "commander"],
    ["hao_zhao", "郝昭", "Hao Zhao", "伯道", "Bodao", "wei", 82, 91, 78, 65, "commander"],
    ["man_chong", "滿寵", "Man Chong", "伯寧", "Boning", "wei", 64, 86, 88, 90, "governor"],
    ["chen_qun", "陳群", "Chen Qun", "長文", "Changwen", "wei", 24, 64, 86, 98, "governor"],
    ["liu_ye", "劉曄", "Liu Ye", "子揚", "Ziyang", "wei", 35, 68, 92, 84, "strategist"],
    ["mao_jie", "毛玠", "Mao Jie", "孝先", "Xiaoxian", "wei", 24, 64, 82, 91, "governor"],
    ["wang_shuang", "王雙", "Wang Shuang", "子全", "Ziquan", "wei", 88, 68, 34, 32, "warrior"],
    ["wen_ping", "文聘", "Wen Ping", "仲業", "Zhongye", "wei", 82, 88, 72, 68, "commander"],
    ["niu_jin", "牛金", "Niu Jin", "—", "—", "wei", 82, 72, 42, 38, "warrior"],
    ["wang_yi", "王異", "Wang Yi", "—", "—", "wei", 74, 78, 82, 78, "commander"],
    ["xin_xianying", "辛憲英", "Xin Xianying", "—", "—", "wei", 28, 62, 92, 88, "strategist"],
    ["wen_yang", "文鴦", "Wen Yang", "次騫", "Ciqian", "jin", 96, 86, 72, 60, "cavalry"],
    ["du_yu", "杜預", "Du Yu", "元凱", "Yuankai", "jin", 48, 90, 94, 92, "commander"],
    ["yang_hu", "羊祜", "Yang Hu", "叔子", "Shuzi", "jin", 60, 92, 92, 96, "commander"],
    ["wang_jun", "王濬", "Wang Jun", "士治", "Shizhi", "jin", 72, 90, 86, 82, "commander"],

    // Sun / Wu cultural roster (40)
    ["sun_jian", "孫堅", "Sun Jian", "文臺", "Wentai", "wu", 94, 92, 72, 68, "lord"],
    ["sun_ce", "孫策", "Sun Ce", "伯符", "Bofu", "wu", 92, 90, 72, 66, "lord"],
    ["sun_quan", "孫權", "Sun Quan", "仲謀", "Zhongmou", "wu", 70, 90, 88, 92, "lord"],
    ["sun_shangxiang", "孫尚香", "Sun Shangxiang", "—", "—", "wu", 82, 72, 68, 65, "archer"],
    ["zhou_yu", "周瑜", "Zhou Yu", "公瑾", "Gongjin", "wu", 80, 94, 97, 82, "strategist"],
    ["lu_su", "魯肅", "Lu Su", "子敬", "Zijing", "wu", 48, 84, 93, 94, "strategist"],
    ["lu_meng", "呂蒙", "Lu Meng", "子明", "Ziming", "wu", 86, 92, 92, 78, "commander"],
    ["lu_xun", "陸遜", "Lu Xun", "伯言", "Boyan", "wu", 70, 94, 97, 88, "strategist"],
    ["lu_kang", "陸抗", "Lu Kang", "幼節", "Youjie", "wu", 68, 93, 94, 90, "commander"],
    ["taishi_ci", "太史慈", "Taishi Ci", "子義", "Ziyi", "wu", 95, 86, 70, 55, "warrior"],
    ["gan_ning", "甘寧", "Gan Ning", "興霸", "Xingba", "wu", 94, 84, 72, 52, "warrior"],
    ["huang_gai", "黃蓋", "Huang Gai", "公覆", "Gongfu", "wu", 86, 88, 72, 68, "commander"],
    ["cheng_pu", "程普", "Cheng Pu", "德謀", "Demou", "wu", 84, 88, 70, 68, "commander"],
    ["han_dang", "韓當", "Han Dang", "義公", "Yigong", "wu", 84, 84, 60, 55, "warrior"],
    ["zhou_tai", "周泰", "Zhou Tai", "幼平", "Youping", "wu", 92, 82, 52, 48, "warrior"],
    ["ling_tong", "凌統", "Ling Tong", "公績", "Gongji", "wu", 90, 84, 68, 58, "warrior"],
    ["jiang_qin", "蔣欽", "Jiang Qin", "公奕", "Gongyi", "wu", 84, 82, 68, 62, "commander"],
    ["dong_xi", "董襲", "Dong Xi", "元代", "Yuandai", "wu", 85, 76, 48, 46, "warrior"],
    ["chen_wu", "陳武", "Chen Wu", "子烈", "Zilie", "wu", 86, 78, 52, 50, "warrior"],
    ["pan_zhang", "潘璋", "Pan Zhang", "文珪", "Wengui", "wu", 82, 80, 62, 50, "warrior"],
    ["ding_feng", "丁奉", "Ding Feng", "承淵", "Chengyuan", "wu", 88, 86, 72, 60, "commander"],
    ["xu_sheng", "徐盛", "Xu Sheng", "文嚮", "Wenxiang", "wu", 84, 88, 70, 62, "commander"],
    ["zhu_ran", "朱然", "Zhu Ran", "義封", "Yifeng", "wu", 80, 86, 76, 68, "commander"],
    ["zhu_zhi", "朱治", "Zhu Zhi", "君理", "Junli", "wu", 72, 82, 70, 78, "governor"],
    ["sun_shao", "孫韶", "Sun Shao", "公禮", "Gongli", "wu", 76, 82, 66, 68, "commander"],
    ["sun_huan", "孫桓", "Sun Huan", "叔武", "Shuwu", "wu", 78, 82, 72, 64, "commander"],
    ["sun_yi", "孫翊", "Sun Yi", "叔弼", "Shubi", "wu", 82, 72, 48, 50, "warrior"],
    ["sun_kuang", "孫匡", "Sun Kuang", "季佐", "Jizuo", "wu", 68, 68, 58, 60, "commander"],
    ["zhuge_jin", "諸葛瑾", "Zhuge Jin", "子瑜", "Ziyu", "wu", 32, 74, 88, 94, "governor"],
    ["zhuge_ke", "諸葛恪", "Zhuge Ke", "元遜", "Yuanxun", "wu", 52, 80, 92, 78, "strategist"],
    ["bu_zhi", "步騭", "Bu Zhi", "子山", "Zishan", "wu", 40, 76, 86, 92, "governor"],
    ["zhang_zhao", "張昭", "Zhang Zhao", "子布", "Zibu", "wu", 18, 62, 88, 98, "governor"],
    ["zhang_hong", "張紘", "Zhang Hong", "子綱", "Zigang", "wu", 22, 64, 88, 94, "governor"],
    ["kan_ze", "闞澤", "Kan Ze", "德潤", "Derun", "wu", 24, 58, 86, 90, "strategist"],
    ["yu_fan", "虞翻", "Yu Fan", "仲翔", "Zhongxiang", "wu", 34, 62, 90, 88, "strategist"],
    ["gu_yong", "顧雍", "Gu Yong", "元歎", "Yuantan", "wu", 20, 62, 86, 96, "governor"],
    ["he_qi", "賀齊", "He Qi", "公苗", "Gongmiao", "wu", 80, 84, 74, 70, "commander"],
    ["quan_cong", "全琮", "Quan Cong", "子璜", "Zihuang", "wu", 76, 82, 72, 74, "commander"],
    ["lianshi", "練師", "Lianshi", "—", "—", "wu", 64, 70, 76, 82, "archer"],
    ["da_qiao", "大喬", "Da Qiao", "—", "—", "wu", 22, 42, 78, 82, "scholar"],

    // Warlords, Han loyalists, rebels, and southern powers (72)
    ["lv_bu", "呂布", "Lü Bu", "奉先", "Fengxian", "other", 100, 78, 30, 20, "warrior"],
    ["dong_zhuo", "董卓", "Dong Zhuo", "仲穎", "Zhongying", "other", 86, 82, 58, 48, "lord"],
    ["diao_chan", "貂蟬", "Diaochan", "—", "—", "other", 68, 70, 88, 78, "strategist"],
    ["yuan_shao", "袁紹", "Yuan Shao", "本初", "Benchu", "yuan", 70, 82, 72, 85, "lord"],
    ["yuan_shu", "袁術", "Yuan Shu", "公路", "Gonglu", "yuan", 62, 66, 58, 72, "lord"],
    ["gongsun_zan", "公孫瓚", "Gongsun Zan", "伯珪", "Bogui", "other", 86, 84, 68, 60, "cavalry"],
    ["ma_teng", "馬騰", "Ma Teng", "壽成", "Shoucheng", "other", 84, 84, 62, 64, "lord"],
    ["han_sui", "韓遂", "Han Sui", "文約", "Wenyue", "other", 74, 82, 82, 76, "lord"],
    ["liu_biao", "劉表", "Liu Biao", "景升", "Jingsheng", "han", 58, 72, 78, 88, "lord"],
    ["liu_zhang", "劉璋", "Liu Zhang", "季玉", "Jiyu", "han", 32, 54, 58, 78, "lord"],
    ["zhang_lu", "張魯", "Zhang Lu", "公祺", "Gongqi", "other", 48, 66, 72, 82, "lord"],
    ["tao_qian", "陶謙", "Tao Qian", "恭祖", "Gongzu", "han", 42, 62, 72, 88, "lord"],
    ["kong_rong", "孔融", "Kong Rong", "文舉", "Wenju", "han", 28, 48, 82, 92, "lord"],
    ["liu_yao", "劉繇", "Liu Yao", "正禮", "Zhengli", "han", 48, 62, 72, 82, "lord"],
    ["wang_lang", "王朗", "Wang Lang", "景興", "Jingxing", "han", 32, 62, 84, 94, "governor"],
    ["yan_baihu", "嚴白虎", "Yan Baihu", "—", "—", "other", 72, 58, 42, 36, "lord"],
    ["zhang_xiu", "張繡", "Zhang Xiu", "—", "—", "other", 86, 82, 72, 58, "cavalry"],
    ["zhang_ji", "張濟", "Zhang Ji", "—", "—", "other", 76, 72, 58, 52, "cavalry"],
    ["hu_che_er", "胡車兒", "Hu Che'er", "—", "—", "other", 86, 62, 38, 30, "warrior"],
    ["gao_shun", "高順", "Gao Shun", "—", "—", "other", 88, 94, 72, 58, "commander"],
    ["chen_gong", "陳宮", "Chen Gong", "公臺", "Gongtai", "other", 52, 80, 94, 82, "strategist"],
    ["zhang_miao", "張邈", "Zhang Miao", "孟卓", "Mengzhuo", "han", 54, 66, 72, 78, "lord"],
    ["zang_ba", "臧霸", "Zang Ba", "宣高", "Xuangao", "other", 82, 84, 72, 68, "commander"],
    ["wei_xu", "魏續", "Wei Xu", "—", "—", "other", 68, 62, 48, 44, "warrior"],
    ["song_xian", "宋憲", "Song Xian", "—", "—", "other", 70, 62, 46, 42, "warrior"],
    ["hou_cheng", "侯成", "Hou Cheng", "—", "—", "other", 68, 62, 52, 48, "warrior"],
    ["hua_xiong", "華雄", "Hua Xiong", "—", "—", "other", 93, 76, 40, 35, "warrior"],
    ["li_jue", "李傕", "Li Jue", "稚然", "Zhiran", "other", 78, 76, 58, 48, "commander"],
    ["guo_si", "郭汜", "Guo Si", "多", "Duo", "other", 76, 72, 52, 44, "commander"],
    ["fan_chou", "樊稠", "Fan Chou", "—", "—", "other", 78, 72, 48, 42, "warrior"],
    ["li_ru", "李儒", "Li Ru", "文優", "Wenyou", "other", 28, 68, 94, 80, "strategist"],
    ["xu_rong", "徐榮", "Xu Rong", "—", "—", "other", 80, 86, 78, 62, "commander"],
    ["ji_ling", "紀靈", "Ji Ling", "—", "—", "yuan", 84, 78, 52, 45, "warrior"],
    ["yuan_tan", "袁譚", "Yuan Tan", "顯思", "Xiansi", "yuan", 72, 68, 54, 58, "lord"],
    ["yuan_xi", "袁熙", "Yuan Xi", "顯奕", "Xianyi", "yuan", 62, 64, 58, 66, "lord"],
    ["yuan_shang", "袁尚", "Yuan Shang", "顯甫", "Xianfu", "yuan", 76, 72, 62, 58, "lord"],
    ["yan_liang", "顏良", "Yan Liang", "—", "—", "yuan", 95, 82, 48, 38, "warrior"],
    ["wen_chou", "文醜", "Wen Chou", "—", "—", "yuan", 94, 80, 52, 40, "warrior"],
    ["gao_lan", "高覽", "Gao Lan", "—", "—", "yuan", 84, 80, 62, 52, "commander"],
    ["qu_yi", "麴義", "Qu Yi", "—", "—", "yuan", 82, 86, 76, 52, "commander"],
    ["tian_feng", "田豐", "Tian Feng", "元皓", "Yuanhao", "yuan", 30, 76, 96, 88, "strategist"],
    ["ju_shou", "沮授", "Ju Shou", "—", "—", "yuan", 35, 82, 94, 90, "strategist"],
    ["shen_pei", "審配", "Shen Pei", "正南", "Zhengnan", "yuan", 60, 84, 82, 74, "commander"],
    [
      "chunyu_qiong",
      "淳于瓊",
      "Chunyu Qiong",
      "仲簡",
      "Zhongjian",
      "yuan",
      72,
      65,
      52,
      48,
      "commander",
    ],
    ["han_fu", "韓馥", "Han Fu", "文節", "Wenjie", "han", 38, 52, 58, 72, "lord"],
    ["bao_xin", "鮑信", "Bao Xin", "允誠", "Yuncheng", "han", 72, 78, 70, 72, "lord"],
    ["qiao_mao", "橋瑁", "Qiao Mao", "元偉", "Yuanwei", "han", 58, 64, 68, 72, "lord"],
    ["wang_kuang", "王匡", "Wang Kuang", "公節", "Gongjie", "han", 62, 66, 62, 68, "lord"],
    ["zhang_yang", "張楊", "Zhang Yang", "稚叔", "Zhishu", "han", 68, 72, 62, 66, "lord"],
    ["liu_dai", "劉岱", "Liu Dai", "公山", "Gongshan", "han", 58, 62, 62, 72, "lord"],
    [
      "huangfu_song",
      "皇甫嵩",
      "Huangfu Song",
      "義真",
      "Yizhen",
      "han",
      78,
      94,
      88,
      84,
      "commander",
    ],
    ["zhu_jun", "朱儁", "Zhu Jun", "公偉", "Gongwei", "han", 76, 90, 84, 82, "commander"],
    ["lu_zhi", "盧植", "Lu Zhi", "子幹", "Zigan", "han", 68, 88, 92, 90, "commander"],
    ["he_jin", "何進", "He Jin", "遂高", "Suigao", "han", 58, 62, 48, 68, "lord"],
    ["wang_yun", "王允", "Wang Yun", "子師", "Zishi", "han", 26, 62, 88, 94, "strategist"],
    ["emperor_xian", "漢獻帝", "Emperor Xian", "伯和", "Bohe", "han", 12, 38, 72, 82, "lord"],
    ["zhang_jue", "張角", "Zhang Jue", "—", "—", "other", 42, 80, 92, 72, "strategist"],
    ["zhang_bao_yellow", "張寶", "Zhang Bao", "—", "—", "other", 72, 76, 78, 58, "commander"],
    ["zhang_liang_yellow", "張梁", "Zhang Liang", "—", "—", "other", 76, 74, 62, 50, "warrior"],
    ["gong_du", "龔都", "Gong Du", "—", "—", "other", 70, 62, 48, 42, "warrior"],
    ["he_yi", "何儀", "He Yi", "—", "—", "other", 68, 60, 50, 44, "warrior"],
    ["pei_yuanshao", "裴元紹", "Pei Yuanshao", "—", "—", "other", 72, 58, 42, 36, "warrior"],
    ["bo_cai", "波才", "Bo Cai", "—", "—", "other", 72, 72, 62, 50, "commander"],
    ["gongsun_du", "公孫度", "Gongsun Du", "升濟", "Shengji", "other", 72, 78, 72, 80, "lord"],
    ["gongsun_kang", "公孫康", "Gongsun Kang", "—", "—", "other", 72, 76, 70, 74, "lord"],
    ["meng_huo", "孟獲", "Meng Huo", "—", "—", "south", 88, 82, 58, 52, "lord"],
    ["lady_zhurong", "祝融夫人", "Lady Zhurong", "—", "—", "south", 90, 76, 62, 54, "warrior"],
    ["king_mulu", "木鹿大王", "King Mulu", "—", "—", "south", 76, 70, 68, 46, "commander"],
    ["shamoke", "沙摩柯", "Shamoke", "—", "—", "south", 86, 72, 42, 38, "warrior"],
    ["zhang_ren", "張任", "Zhang Ren", "—", "—", "other", 86, 90, 82, 62, "commander"],
    ["yan_yan", "嚴顏", "Yan Yan", "—", "—", "other", 84, 82, 72, 68, "commander"],
    ["pan_feng", "潘鳳", "Pan Feng", "—", "—", "han", 88, 68, 38, 34, "warrior"],
  ];

  function hashText(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function autoSkills(id, role, wu, tong, zhi) {
    if (LEGENDARY_SKILLS[id]) return LEGENDARY_SKILLS[id].slice();
    const skills = [];
    if (wu >= 86 || role === "warrior") skills.push("valiant");
    else if (tong >= 86 || role === "commander" || role === "lord") skills.push("iron_wall");
    else if (role === "cavalry") skills.push("swift");
    else skills.push("discipline");

    if (zhi >= 88) {
      const tactics = ["fire", "ambush", "disorder"];
      skills.push(tactics[hashText(id) % tactics.length]);
    } else if (wu >= 82 || role === "cavalry") skills.push("charge");
    else skills.push("inspire");

    if (Math.max(wu, tong, zhi) >= 92) {
      const extra = tong >= zhi ? "inspire" : "disorder";
      if (!skills.includes(extra)) skills.push(extra);
    }
    return skills;
  }

  function proceduralPortrait(id, role) {
    const h = hashText(id);
    const female =
      id === "wang_yi" || id === "xin_xianying" || id === "lianshi" || id === "da_qiao";
    return {
      cap: female
        ? "band"
        : role === "strategist" || role === "scholar"
          ? "crown"
          : CAPS[h % CAPS.length],
      beard: female ? "none" : BEARDS[(h >>> 4) % BEARDS.length],
      cue: CUES[(h >>> 8) % CUES.length],
      feature: female ? "hair_ribbons" : null,
    };
  }

  function proceduralModel(id, role, faction) {
    const h = hashText(id);
    let weapon = "spear";
    if (role === "strategist" || role === "scholar" || role === "governor") weapon = "feather_fan";
    else if (role === "archer") weapon = "bow";
    else if (role === "warrior") weapon = h & 1 ? "glaive" : "great_sabre";
    else if (role === "lord") weapon = "sword";
    return {
      mounted: true,
      scale: 1.5,
      mount: role === "cavalry" ? "white" : MOUNTS[(h >>> 5) % MOUNTS.length],
      weapon,
      armor: role === "strategist" || role === "scholar" ? "robe" : "lamellar",
      robe: faction,
      feature: null,
    };
  }

  function makeGeneral(row) {
    const [id, zh, en, styleZh, styleEn, faction, wu, tong, zhi, zheng, role] = row;
    const iconic = ICONIC[id];
    const portrait = iconic
      ? { cap: iconic[0], beard: iconic[1], cue: iconic[2], feature: iconic[6] }
      : proceduralPortrait(id, role);
    const model = iconic
      ? {
          mounted: true,
          scale: 1.5,
          weapon: iconic[3],
          mount: iconic[4],
          armor: role === "strategist" ? "robe" : "hero_lamellar",
          robe: iconic[5],
          feature: iconic[6],
        }
      : proceduralModel(id, role, faction);
    const skillIds = autoSkills(id, role, wu, tong, zhi);
    const max = Math.max(wu, tong, zhi, zheng);
    const rarity = LEGENDARY_SKILLS[id] ? "legendary" : max >= 92 ? "renowned" : "common";
    return {
      id,
      name: { "zh-tw": zh, en },
      style: { "zh-tw": styleZh, en: styleEn },
      faction,
      factionId: COLOR[faction],
      role,
      wu,
      tong,
      zhi,
      zheng,
      level: 1,
      xp: 0,
      loyalty: role === "lord" ? 100 : 78 + (hashText(id) % 18),
      skillIds,
      skills: skillIds.map((skillId) => ({ id: skillId, rank: rarity === "legendary" ? 3 : 1 })),
      itemIds: ["weapon:" + model.weapon, "mount:" + model.mount],
      injury: "none",
      location: null,
      rarity,
      portrait,
      model,
    };
  }

  const CATALOGUE = {};
  const ALL = [];
  for (let i = 0; i < ROWS.length; i++) {
    const g = makeGeneral(ROWS[i]);
    CATALOGUE[g.id] = g;
    ALL.push(g);
  }

  function get(id) {
    return CATALOGUE[id] || null;
  }

  /* BattleSetup/save-friendly copy. Bilingual content and appearance recipes
     are immutable references; mutable RPG arrays are copied. */
  function snapshot(id, extra) {
    const g = get(id);
    if (!g) return null;
    return Object.assign(
      {
        id: g.id,
        name: g.name,
        style: g.style,
        faction: g.faction,
        factionId: g.factionId,
        role: g.role,
        wu: g.wu,
        tong: g.tong,
        zhi: g.zhi,
        zheng: g.zheng,
        level: g.level,
        xp: g.xp,
        loyalty: g.loyalty,
        skillIds: g.skillIds.slice(),
        skills: g.skills.map((s) => ({ id: s.id, rank: s.rank })),
        itemIds: g.itemIds.slice(),
        injury: g.injury,
        location: g.location,
        rarity: g.rarity,
        portrait: g.portrait,
        model: g.model,
      },
      extra || {},
    );
  }

  ZS.Generals = { ALL, CATALOGUE, ICONIC, get, snapshot };
})();
