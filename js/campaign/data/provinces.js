/* ZS.data.provinces — the campaign map's nodes (docs/SANGUO-DESIGN.md §4.1).

   ~57 Han commanderies (郡) grouped under the 13 provinces (州) of 194 CE.
   Node = the commandery seat; the edges below are the marching routes.

   This file is *content*, not state. A running campaign never writes here —
   it holds its own province records keyed by these ids (js/campaign/campaign.js),
   so a save stores ids and levels, never place names (§5.3).

   Coordinates are on a nominal 1000 x 700 paper map, north-up, west-left. They
   are a legible schematic of the Han empire, not a survey: the map has to read
   as a hand-drawn sheet at a glance, so seats are spaced for the label rather
   than pinned to a latitude.

   Fields
     id        stable key; the save references this
     name      bilingual content object (§6.2) — resolved with ZS.i18n.t()
     region    key into REGIONS (the 州 it belongs to)
     x, y      map position
     size      1 small / 2 middling / 3 great — scales income, food, recruit cap
     wall      0 open town · 1 walled city · 2 fortress; P4 reads this for field.kind
     biome     terrain flavour; P4 hands it to ScenarioSanguo.terrain()
     port      on a navigable river or the sea — flavour now, naval later */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const data = (ZS.data = ZS.data || {});

  /* The 13 州. `seat` is the commandery that reads as the province capital;
     it is only used for map lettering. */
  const REGIONS = {
    you: { name: { "zh-tw": "幽州", en: "You" }, seat: "zhuo" },
    bing: { name: { "zh-tw": "并州", en: "Bing" }, seat: "taiyuan" },
    ji: { name: { "zh-tw": "冀州", en: "Ji" }, seat: "ye" },
    qing: { name: { "zh-tw": "青州", en: "Qing" }, seat: "beihai" },
    liang: { name: { "zh-tw": "涼州", en: "Liang" }, seat: "wuwei" },
    si: { name: { "zh-tw": "司隸", en: "Sili" }, seat: "luoyang" },
    yan: { name: { "zh-tw": "兗州", en: "Yan" }, seat: "puyang" },
    xu: { name: { "zh-tw": "徐州", en: "Xu" }, seat: "xiapi" },
    yu: { name: { "zh-tw": "豫州", en: "Yu" }, seat: "xuchang" },
    jing: { name: { "zh-tw": "荊州", en: "Jing" }, seat: "xiangyang" },
    yang: { name: { "zh-tw": "揚州", en: "Yang" }, seat: "shouchun" },
    yi: { name: { "zh-tw": "益州", en: "Yi" }, seat: "chengdu" },
    jiao: { name: { "zh-tw": "交州", en: "Jiao" }, seat: "nanhai" },
  };

  /* biome -> the battlefield flavour P4 will hand the scenario. */
  const BIOMES = ["plain", "hill", "river", "wood", "marsh"];

  function p(id, zh, en, region, x, y, size, wall, biome, port) {
    return {
      id,
      name: { "zh-tw": zh, en },
      region,
      x,
      y,
      size,
      wall,
      biome,
      port: !!port,
    };
  }

  const PROVINCES = [
    // — 幽州 —
    p("liaodong", "遼東", "Liaodong", "you", 960, 62, 2, 1, "plain", true),
    p("youbeiping", "右北平", "Youbeiping", "you", 862, 92, 1, 1, "hill"),
    p("yuyang", "漁陽", "Yuyang", "you", 800, 112, 2, 1, "plain"),
    p("zhuo", "涿郡", "Zhuo", "you", 768, 146, 2, 1, "plain"),

    // — 并州 —
    p("yanmen", "雁門", "Yanmen", "bing", 620, 104, 1, 2, "hill"),
    p("taiyuan", "太原", "Taiyuan", "bing", 640, 166, 2, 1, "hill"),
    p("shangdang", "上黨", "Shangdang", "bing", 672, 212, 1, 2, "hill"),

    // — 冀州 —
    p("zhongshan", "中山", "Zhongshan", "ji", 740, 180, 2, 1, "plain"),
    p("bohai", "渤海", "Bohai", "ji", 832, 186, 3, 1, "plain", true),
    p("julu", "鉅鹿", "Julu", "ji", 760, 220, 2, 0, "plain"),
    p("ye", "魏郡", "Wei", "ji", 734, 256, 3, 2, "plain"),
    p("qinghe", "清河", "Qinghe", "ji", 790, 246, 2, 0, "river", true),

    // — 青州 —
    p("pingyuan", "平原", "Pingyuan", "qing", 830, 266, 2, 0, "plain"),
    p("jinan", "濟南", "Jinan", "qing", 860, 300, 2, 1, "river", true),
    p("beihai", "北海", "Beihai", "qing", 906, 300, 2, 1, "plain", true),

    // — 涼州 —
    p("wuwei", "武威", "Wuwei", "liang", 300, 130, 2, 1, "plain"),
    p("anding", "安定", "Anding", "liang", 400, 176, 2, 1, "hill"),
    p("longxi", "隴西", "Longxi", "liang", 350, 222, 1, 1, "hill"),
    p("tianshui", "天水", "Tianshui", "liang", 412, 232, 2, 1, "hill"),

    // — 司隸 —
    p("changan", "長安", "Chang'an", "si", 490, 246, 3, 2, "plain"),
    p("hongnong", "弘農", "Hongnong", "si", 560, 262, 1, 2, "hill"),
    p("luoyang", "洛陽", "Luoyang", "si", 620, 276, 3, 2, "river", true),
    p("henei", "河內", "Henei", "si", 666, 240, 2, 1, "river", true),

    // — 兗州 —
    p("chenliu", "陳留", "Chenliu", "yan", 710, 296, 3, 1, "plain"),
    p("puyang", "濮陽", "Puyang", "yan", 750, 286, 2, 1, "river", true),
    p("jibei", "濟北", "Jibei", "yan", 800, 302, 2, 0, "plain"),
    p("taishan", "泰山", "Taishan", "yan", 846, 332, 1, 2, "hill"),

    // — 徐州 —
    p("pengcheng", "彭城", "Pengcheng", "xu", 830, 372, 2, 1, "plain"),
    p("xiapi", "下邳", "Xiapi", "xu", 866, 386, 3, 2, "river", true),
    p("donghai", "東海", "Donghai", "xu", 896, 356, 2, 1, "plain", true),
    p("guangling", "廣陵", "Guangling", "xu", 880, 426, 2, 1, "marsh", true),

    // — 豫州 —
    p("xuchang", "許昌", "Xuchang", "yu", 690, 336, 3, 1, "plain"),
    p("chenguo", "陳國", "Chen", "yu", 746, 346, 2, 1, "plain"),
    p("qiao", "譙郡", "Qiao", "yu", 786, 342, 2, 0, "plain"),
    p("runan", "汝南", "Runan", "yu", 720, 392, 3, 1, "plain"),

    // — 荊州 —
    p("nanyang", "南陽", "Nanyang", "jing", 640, 342, 3, 1, "plain"),
    p("xiangyang", "襄陽", "Xiangyang", "jing", 630, 402, 3, 2, "river", true),
    p("jiangling", "江陵", "Jiangling", "jing", 620, 456, 3, 2, "river", true),
    p("jiangxia", "江夏", "Jiangxia", "jing", 700, 460, 2, 1, "river", true),
    p("wuling", "武陵", "Wuling", "jing", 546, 500, 1, 0, "wood"),
    p("changsha", "長沙", "Changsha", "jing", 640, 520, 2, 1, "river", true),
    p("lingling", "零陵", "Lingling", "jing", 570, 570, 1, 0, "wood"),
    p("guiyang", "桂陽", "Guiyang", "jing", 650, 580, 1, 0, "hill"),

    // — 揚州 —
    p("shouchun", "壽春", "Shouchun", "yang", 810, 406, 3, 2, "river", true),
    p("lujiang", "廬江", "Lujiang", "yang", 800, 446, 2, 1, "river", true),
    p("danyang", "丹陽", "Danyang", "yang", 850, 470, 2, 1, "hill", true),
    p("wujun", "吳郡", "Wu", "yang", 910, 470, 3, 1, "marsh", true),
    p("kuaiji", "會稽", "Kuaiji", "yang", 926, 522, 2, 1, "marsh", true),
    p("yuzhang", "豫章", "Yuzhang", "yang", 770, 520, 2, 1, "wood", true),

    // — 益州 —
    p("hanzhong", "漢中", "Hanzhong", "yi", 446, 302, 2, 2, "hill"),
    p("bajun", "巴郡", "Ba", "yi", 400, 380, 2, 1, "hill", true),
    p("chengdu", "蜀郡", "Chengdu", "yi", 330, 360, 3, 2, "plain"),
    p("qianwei", "犍為", "Qianwei", "yi", 330, 422, 2, 1, "hill"),
    p("badong", "巴東", "Badong", "yi", 480, 422, 1, 2, "river", true),
    p("jianning", "建寧", "Jianning", "yi", 330, 546, 1, 0, "wood"),

    // — 交州 —
    p("nanhai", "南海", "Nanhai", "jiao", 740, 640, 2, 1, "wood", true),
    p("jiaozhi", "交趾", "Jiaozhi", "jiao", 560, 666, 1, 1, "marsh", true),
  ];

  /* Marching routes. Listed once; js/campaign/map.js builds both directions
     and derives the march cost from the map distance, so a long haul across
     Liang really does take more seasons than a hop inside Ji. */
  const EDGES = [
    ["liaodong", "youbeiping"],
    ["youbeiping", "yuyang"],
    ["yuyang", "zhuo"],
    ["zhuo", "zhongshan"],
    ["zhuo", "bohai"],
    ["zhuo", "yanmen"],
    ["yanmen", "taiyuan"],
    ["taiyuan", "shangdang"],
    ["taiyuan", "zhongshan"],
    ["shangdang", "henei"],
    ["shangdang", "ye"],
    ["zhongshan", "julu"],
    ["zhongshan", "bohai"],
    ["bohai", "qinghe"],
    ["bohai", "pingyuan"],
    ["julu", "ye"],
    ["julu", "qinghe"],
    ["ye", "qinghe"],
    ["ye", "henei"],
    ["ye", "puyang"],
    ["qinghe", "pingyuan"],
    ["pingyuan", "jinan"],
    ["jinan", "beihai"],
    ["jinan", "taishan"],
    ["jinan", "jibei"],
    ["beihai", "donghai"],
    ["wuwei", "anding"],
    ["wuwei", "longxi"],
    ["anding", "longxi"],
    ["anding", "tianshui"],
    ["anding", "changan"],
    ["longxi", "tianshui"],
    ["tianshui", "changan"],
    ["tianshui", "hanzhong"],
    ["changan", "hongnong"],
    ["changan", "hanzhong"],
    ["hongnong", "luoyang"],
    ["hongnong", "nanyang"],
    ["luoyang", "henei"],
    ["luoyang", "chenliu"],
    ["luoyang", "nanyang"],
    ["luoyang", "xuchang"],
    ["chenliu", "puyang"],
    ["chenliu", "xuchang"],
    ["chenliu", "chenguo"],
    ["puyang", "jibei"],
    ["jibei", "taishan"],
    ["jibei", "pengcheng"],
    ["taishan", "donghai"],
    ["taishan", "pengcheng"],
    ["pengcheng", "xiapi"],
    ["pengcheng", "qiao"],
    ["xiapi", "donghai"],
    ["xiapi", "guangling"],
    ["xiapi", "shouchun"],
    ["donghai", "guangling"],
    ["guangling", "shouchun"],
    ["guangling", "danyang"],
    ["xuchang", "chenguo"],
    ["xuchang", "runan"],
    ["xuchang", "nanyang"],
    ["chenguo", "qiao"],
    ["chenguo", "runan"],
    ["qiao", "runan"],
    ["qiao", "shouchun"],
    ["runan", "shouchun"],
    ["runan", "nanyang"],
    ["nanyang", "xiangyang"],
    ["xiangyang", "jiangling"],
    ["xiangyang", "jiangxia"],
    ["xiangyang", "hanzhong"],
    ["jiangling", "jiangxia"],
    ["jiangling", "wuling"],
    ["jiangling", "changsha"],
    ["jiangling", "badong"],
    ["jiangxia", "changsha"],
    ["jiangxia", "yuzhang"],
    ["jiangxia", "lujiang"],
    ["wuling", "changsha"],
    ["wuling", "lingling"],
    ["wuling", "badong"],
    ["changsha", "lingling"],
    ["changsha", "guiyang"],
    ["changsha", "yuzhang"],
    ["lingling", "guiyang"],
    ["lingling", "jiaozhi"],
    ["guiyang", "yuzhang"],
    ["guiyang", "nanhai"],
    ["shouchun", "lujiang"],
    ["lujiang", "danyang"],
    ["lujiang", "yuzhang"],
    ["danyang", "wujun"],
    ["danyang", "yuzhang"],
    ["wujun", "kuaiji"],
    ["kuaiji", "yuzhang"],
    ["yuzhang", "nanhai"],
    ["hanzhong", "bajun"],
    ["hanzhong", "badong"],
    ["bajun", "chengdu"],
    ["bajun", "qianwei"],
    ["bajun", "badong"],
    ["chengdu", "qianwei"],
    ["qianwei", "jianning"],
    ["jianning", "jiaozhi"],
    ["badong", "wuling"],
    ["nanhai", "jiaozhi"],
  ];

  /* The map sheet the camera is sized to. Provinces sit inside it with a
     margin so labels and the border cartouche have room. */
  const MAP = { w: 1000, h: 700 };

  data.provinces = PROVINCES;
  data.provinceEdges = EDGES;
  data.regions = REGIONS;
  data.biomes = BIOMES;
  data.mapSize = MAP;
})();
