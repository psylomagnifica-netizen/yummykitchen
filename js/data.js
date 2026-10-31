/* ============================================================
 * data.js — 六道菜配置化脚本（对应 PRD 第 5 节与 F11 配置化建议）
 * 每道菜：步骤、动作、视觉状态、音效、气味模块、失败条件、分支、结果卡字段
 * ============================================================ */
"use strict";

const DISHES = [
  {
    id: "chaofan",
    name: "炒饭",
    title: "别把这锅炒糊了",
    img: "assets/dish/04_菜品_炒饭.jpg?v=5",
    core: true,                       // P0 核心可运行路径
    stepCount: 5,
    scentTags: ["蛋香", "米香", "炒饭香", "低强度焦糊"],
    desc: "热锅、下料、翻炒、掌火——一锅金黄炒饭的完整链路。",
    ingredients: [
      { id: "egg",    name: "鸡蛋",   img: "assets/ing/炒饭_鸡蛋_蛋黄.png?v=7",   scent: "egg" },
      // 「一碗米」：碗固定在备料台上，只有米能拖进锅里
      { id: "rice",   name: "米饭",   img: "assets/ing/米_散.png?v=6",            potImg: "assets/ing/米_散.png?v=6",            bowlImg: "assets/tool/bowl_new.png?v=6",   scent: "rice" },
      { id: "carrot", name: "胡萝卜", img: "assets/ing/炒饭_胡萝卜.png?v=5",      scent: "rice" },
      { id: "scallion", name: "葱花", img: "assets/ing/炒饭_葱花.png?v=5",        scent: "allium" },
    ],
    steps: ["热锅备料", "依次下料", "环形翻炒", "掌控火候", "盛出装盘"],
    memoryScent: "炒饭香",
  },
  {
    id: "zongzi",
    name: "粽子",
    title: "咸甜粽选择题",
    img: "assets/dish/02_菜品_粽子.jpg?v=5",
    core: true,
    stepCount: 4,
    scentTags: ["粽叶清香", "糯米蒸煮香", "低强度过火"],
    desc: "咸口还是甜口？包紧、蒸熟，别漏米。",
    branch: {
      prompt: "先做个选择：你是咸粽党还是甜粽党？",
      options: [
        { id: "salty", name: "咸口 · 五花肉咸蛋黄", fillings: [
          { id: "pork", name: "五花肉", img: "assets/ing/粽子_五花肉.png?v=5" },
          { id: "yolk", name: "咸蛋黄", img: "assets/ing/粽子_咸蛋黄.png?v=5" },
        ]},
        { id: "sweet", name: "甜口 · 红豆沙红枣", fillings: [
          { id: "beanpaste", name: "红豆沙", img: "assets/ing/粽子_红豆沙.png?v=5" },
          { id: "jujube", name: "红枣", img: "assets/ing/粽子_红枣.png?v=5" },
        ]},
      ],
    },
    baseIngredients: [
      // 「一碗糯米」：碗固定在备料台上，只有米能拖到粽叶上
      { id: "zongrice", name: "糯米", img: "assets/ing/米_散.png?v=6", potImg: "assets/ing/米_散.png?v=6", bowlImg: "assets/tool/bowl_new.png?v=6" },
    ],
    leafImg: "assets/ing/粽子_粽叶.png?v=5",
    steamerImg: "assets/tool/steamer.png?v=5",
    steps: ["选择口味", "包裹粽子", "柴火蒸煮", "起锅分享"],
    memoryScent: "粽叶清香",
  },
  {
    id: "naicha",
    name: "奶茶",
    title: "甜度由你调",
    img: "assets/dish/01_菜品_奶茶.jpg?v=5",
    core: true,
    stepCount: 4,
    scentTags: ["茶香", "奶香"],
    desc: "选茶底、调甜度、顺时针搅拌、封杯。",
    cupImg: "assets/ing/奶茶_玻璃杯.png?v=6",
    cupFullImg: "assets/ing/奶茶_装满牛奶.png?v=6",
    cupMilkMask: "assets/ing/奶茶_牛奶遮罩.png?v=6",
    steps: ["选择茶底", "加奶调甜", "顺时针搅拌", "封杯完成"],
    ingredients: [
      { id: "tea",  name: "茶叶",   img: "assets/ing/奶茶_茶叶.png?v=5" },
      { id: "milk", name: "牛奶",   img: "assets/ing/奶茶_牛奶瓶.png?v=5" },
      { id: "ice",  name: "冰块",   img: "assets/ing/奶茶_冰块.png?v=5" },
    ],
    memoryScent: "茶香 × 奶香",
    script: [
      ["选茶底", "红茶 / 乌龙 / 茉莉", "茶汤颜色随茶底变化", "轻柔倒茶声、确认音", "轻微茶香（不同茶底可区分）", "—"],
      ["加奶与调甜", "选奶量/甜度，倒入手势", "奶液融入、颜色渐变", "液体倾倒声", "奶香联想", "配比不当有颜色/进度提示"],
      ["搅拌", "顺时针搅拌手势", "液体旋转、颜色均匀", "搅拌声、冰块轻碰声", "茶香与奶香短暂组合", "—"],
      ["封杯", "按压/封杯手势", "封口完成、成品图", "封杯“咔哒”声", "停止输出", "不使用焦糊味"],
    ],
  },
  {
    id: "huoguo",
    name: "火锅",
    title: "这一锅你来配",
    img: "assets/dish/03_菜品_火锅.jpg?v=5",
    core: true,
    stepCount: 4,
    scentTags: ["火锅香", "菌菇香", "葱姜香"],
    desc: "选锅底、配食材、下锅涮煮。",
    steps: ["选择锅底", "挑选食材下锅", "涮煮计时", "开吃分享"],
    ingredients: [
      { id: "beef",     name: "肥牛卷", img: "assets/ing/火锅_肥牛卷.png?v=5" },
      { id: "mushroom", name: "香菇",   img: "assets/ing/火锅_香菇.png?v=5" },
      { id: "tofu",     name: "豆腐",   img: "assets/ing/火锅_豆腐.png?v=5" },
      { id: "greens",   name: "小青菜", img: "assets/ing/火锅_小青菜.png?v=5" },
    ],
    memoryScent: "火锅香",
    script: [
      ["选锅底", "清汤 / 菌菇 / 麻辣", "锅底颜色、油花变化", "倒汤声、沸腾声渐强", "按锅底释放对应香气", "—"],
      ["选食材", "肉类、菌菇、蔬菜搭配", "食材卡片进入备菜区", "食材入盘轻响", "少量短时气味提示", "菌菇仅为游戏内容"],
      ["下锅", "向锅中推送手势", "食材入锅、汤面波动", "下锅声、沸腾声变化", "锅底香与食材香组合", "—"],
      ["控制涮煮", "手势/计时控制", "食材颜色变化、适宜区间提示", "沸腾声随火力变化", "维持锅底香；煮久以视听为主", "煮过久视觉提示"],
      ["完成分享", "提交搭配", "生成“我的火锅搭配”结果卡", "完成提示音", "停止输出", "—"],
    ],
  },
  {
    id: "suancaiyu",
    name: "酸菜鱼",
    title: "酸爽值正在加载",
    img: "assets/dish/05_菜品_酸菜鱼.jpg?v=5",
    core: true,
    stepCount: 4,
    scentTags: ["葱姜香", "热汤香"],
    desc: "调酸辣、下酸菜、滑鱼片、看火候。",
    steps: ["调口味", "备酸菜汤底", "滑入鱼片", "掌控火候"],
    ingredients: [
      { id: "pickle", name: "酸菜", img: "assets/ing/酸菜鱼_酸菜.png?v=5", potImg: "assets/ing/酸菜鱼_酸菜_散.png?v=5" },
      { id: "fish",   name: "鱼片", img: "assets/ing/酸菜鱼_鱼片.png?v=5" },
      { id: "ginger", name: "姜片", img: "assets/ing/酸菜鱼_姜片.png?v=5" },
      { id: "pepper", name: "红辣椒", img: "assets/ing/酸菜鱼_红辣椒.png?v=5" },
    ],
    memoryScent: "酸菜与葱姜香",
    script: [
      ["选口味", "酸度、辣度、是否加花椒", "酸菜辣椒图标更新、汤色变化", "选择确认音", "暂不输出，显示香气路线", "—"],
      ["备酸菜汤底", "下料手势", "配料进入汤底", "下料声、汤汁翻动声", "酸菜与葱姜香联想", "不以气味模拟酸味"],
      ["加入鱼片", "轻推手势", "鱼片逐片入汤、蒸汽上升", "汤面声变柔和", "热汤香气", "—"],
      ["控制火候", "选择煮制时间并确认", "鱼片由半透明转熟成", "适时提示音；过久警示音", "保持汤底香；不作熟度检测", "火候不合适有状态提示"],
      ["出锅分享", "盛出手势", "展示酸度辣度完成度", "完成提示音", "停止输出", "—"],
    ],
  },
  {
    id: "xianhuabing",
    name: "鲜花饼",
    title: "烤到花香刚刚好",
    img: "assets/dish/06_菜品_鲜花饼.jpg?v=5",
    core: true,
    stepCount: 4,
    scentTags: ["花香", "烘焙香", "低强度焦糊"],
    desc: "选花馅、包馅整形、推入烤箱、盯住上色。",
    steps: ["选花馅饼皮", "包馅整形", "推入烤箱", "掌握烘烤"],
    ingredients: [
      { id: "flour",  name: "面粉",     img: "assets/ing/鲜花饼_面粉.png?v=5" },
      { id: "dough",  name: "面团",     img: "assets/ing/鲜花饼_面团.png?v=5" },
      { id: "rose",   name: "玫瑰花瓣", img: "assets/ing/鲜花饼_玫瑰花瓣.png?v=5" },
    ],
    doughImg: "assets/ing/鲜花饼_面团.png?v=5",
    boardImg: "assets/tool/board.png?v=5",
    memoryScent: "烘焙香",
    script: [
      ["选花馅", "玫瑰等花香馅、饼皮厚度", "花馅、饼皮、配料卡片", "轻柔确认音", "短暂淡花香提示", "—"],
      ["包馅整形", "捏合、包裹、轻压手势", "饼皮包住馅料成型", "面团轻压、托盘轻响", "不持续输出", "—"],
      ["放入烤箱", "推入烤箱手势并设时间", "烤箱灯亮、饼面上色", "烤箱关闭声、计时音", "中段淡花香/烘焙香", "—"],
      ["掌握烘烤", "根据颜色停止或继续", "合适金黄；过久加深", "合适提示音；过久警示音", "合适烘焙香；过火低强度焦糊", "烘烤过久表面变深"],
      ["出炉分享", "取出手势", "成品展示", "烤箱打开声、完成音", "短暂成品香后停止", "—"],
    ],
  },
];

/* 气味模块表（PRD 附录 A）：统一由 triggerScent(moduleId) 调用 */
const SCENT_MODULES = {
  tea:     { name: "茶香",     note: "清雅茶香" },
  milk:    { name: "奶香",     note: "温润奶香" },
  rice:    { name: "米香",     note: "米饭的甜润气息" },
  egg:     { name: "蛋香",     note: "蛋液入锅的香气" },
  allium:  { name: "葱姜香",   note: "葱花爆香" },
  hotpot:  { name: "火锅香",   note: "锅底翻滚的浓香" },
  mushroom:{ name: "菌菇香",   note: "菌菇的山野气" },
  leaf:    { name: "粽叶清香", note: "箬叶的青气" },
  steamRice:{ name: "糯米蒸煮香", note: "蒸汽里的糯香" },
  floral:  { name: "花香",     note: "淡淡玫瑰花香" },
  bake:    { name: "烘焙香",   note: "面皮烘烤的暖香" },
  fryrice: { name: "炒饭香",   note: "锅气十足的炒饭香" },
  soup:    { name: "热汤香",   note: "翻滚的热汤香气" },
  burnt:   { name: "低强度焦糊", note: "短暂低强度模拟 · 非真实燃烧" },
  over:    { name: "低强度过火", note: "轻微过火提示 · 短时模拟" },
};
