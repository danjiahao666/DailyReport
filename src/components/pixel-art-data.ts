/**
 * 像素画的位图数据。
 *
 * 每张图是一组等宽的字符串，一个字符 = 一个像素，`.` 表示透明，
 * 其余字符在各自的调色板里查色。数据与渲染分开放，
 * 是为了能在测试里校验「每行等宽、用到的字符都有颜色」——
 * 手敲的位图最容易错在少一格、多一格，渲染出来歪一列很难一眼看出。
 */

export interface Bitmap {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

/** 墨线统一用站点的墨色，保证所有图标与面板描边同色 */
const INK = "#10141c";

/** 吉祥物：抱着日报本的小记录员 */
export const MASCOT: Bitmap = {
  rows: [
    "......KKKK......",
    "....KKHHHHKK....",
    "...KHHHJJHHHK...",
    "..KHHHHHHHHHHK..",
    "..KHHHHHHHHHHK..",
    "..KHSSHHHHSSHK..",
    "..KHSSSSSSSSHK..",
    "..KSSKSSSSKSSK..",
    "..KSSKSSSSKSSK..",
    "..KSRRSSSSRRSK..",
    "...KSSSKKSSSK...",
    "....KKKKKKKK....",
    "...KBBBBBBBBK...",
    "..KBBBPPPPBBBK..",
    "..KSBBPYPPBBSK..",
    "...KKKKKKKKKK...",
  ],
  palette: {
    K: INK,
    H: "#6b4636",
    J: "#8c6049",
    S: "#f6d5b5",
    R: "#f0907c",
    B: "#62b6e0",
    P: "#fbf6ea",
    Y: "#f2cf6a",
  },
};

/** 有日报的日子：一颗星 */
export const STAR: Bitmap = {
  rows: [
    "....K....",
    "...KYK...",
    "...KYK...",
    "KKKKYKKKK",
    "KYYHYYYYK",
    ".KYYYYYK.",
    ".KYYKYYK.",
    ".KYK.KYK.",
    "..K...K..",
  ],
  palette: { K: INK, Y: "#f2cf6a", H: "#fff1b3" },
};

/** 周报：一卷竹简式卷轴 */
export const SCROLL: Bitmap = {
  rows: [
    ".KKKKKKKK.",
    "KGGGGGGGGK",
    ".KPPPPPPK.",
    ".KPLLLLPK.",
    ".KPPPPPPK.",
    ".KPLLLPPK.",
    ".KPPPPPPK.",
    "KGGGGGGGGK",
    ".KKKKKKKK.",
  ],
  palette: { K: INK, G: "#6fbf73", P: "#fbf6ea", L: "#8c8468" },
};

/** 月报：一只宝箱 */
export const CHEST: Bitmap = {
  rows: [
    "..KKKKKKKKK..",
    ".KOOOOOOOOOK.",
    "KOOOWWWWWOOOK",
    "KOOOOOOOOOOOK",
    "KKKKKKYKKKKKK",
    "KWWWWYYYWWWWK",
    "KOOOOOYOOOOOK",
    "KOOOOOOOOOOOK",
    "KWWWWWWWWWWWK",
    "KKKKKKKKKKKKK",
  ],
  palette: { K: INK, O: "#c9794f", W: "#8a4a32", Y: "#f2cf6a" },
};

/** 天际线上的小屋。颜色走 CSS 变量，白天是红顶米墙，夜里是剪影加亮灯的窗 */
export const HOUSE: Bitmap = {
  rows: [
    ".....RR.....",
    "....RRRR....",
    "...RRRRRR...",
    "..RRRRRRRR..",
    ".RRRRRRRRRR.",
    "RRRRRRRRRRRR",
    ".WWWWWWWWWW.",
    ".WLLWWWWLLW.",
    ".WLLWWWWLLW.",
    ".WWWWDDWWWW.",
    ".WWWWDDWWWW.",
  ],
  palette: { R: "var(--house-roof)", W: "var(--house-wall)", L: "var(--house-light)", D: "var(--house-door)" },
};

/** 天际线上的小树 */
export const TREE: Bitmap = {
  rows: [
    "..ggg..",
    ".ggGgg.",
    "gggGGgg",
    ".gGGGg.",
    "gGGGGGg",
    "..GGG..",
    "...T...",
    "...T...",
  ],
  palette: { g: "var(--tree-light)", G: "var(--tree-dark)", T: "var(--tree-trunk)" },
};

/** 云：浅色像素团，透明度由调用处决定 */
export const CLOUD: Bitmap = {
  rows: [
    "......YYYYYY........",
    "....YYYYYYYYYY.YYY..",
    "..YYYYYYYYYYYYYYYYY.",
    ".YYYYYYYYYYYYYYYYYYY",
    "YYYYYYYYYYYYYYYYYYYY",
  ],
  palette: { Y: "#fffaf0" },
};

/** 夜空的月亮 */
export const MOON: Bitmap = {
  rows: [
    "...MMMM...",
    "..MMMMMM..",
    ".MMSMMMMM.",
    "MMMMMMSMMM",
    "MMMMMMMMMM",
    "MSMMMMMMMM",
    "MMMMMMMSMM",
    ".MMMMMMMM.",
    "..MMMSMM..",
    "...MMMM...",
  ],
  palette: { M: "#fff4c2", S: "#d9cf9a" },
};

/** 切换按钮上的小太阳（点击后进入白天） */
export const SUN_ICON: Bitmap = {
  rows: [
    "....Y....",
    ".Y.....Y.",
    "..YYYYY..",
    "..YYYYY..",
    "Y.YYYYY.Y",
    "..YYYYY..",
    "..YYYYY..",
    ".Y.....Y.",
    "....Y....",
  ],
  palette: { Y: "#e0902a" },
};

/** 切换按钮上的小月牙（点击后进入夜晚） */
export const MOON_ICON: Bitmap = {
  rows: [
    "...MMMM..",
    "..MMM....",
    ".MMM.....",
    ".MMM.....",
    ".MMM.....",
    ".MMM.....",
    "..MMM..MM",
    "...MMMMM.",
    ".....MM..",
  ],
  palette: { M: "#3b4b6b" },
};

export const ALL_BITMAPS: Record<string, Bitmap> = { MASCOT, STAR, SCROLL, CHEST, HOUSE, TREE, CLOUD, MOON, SUN_ICON, MOON_ICON };
