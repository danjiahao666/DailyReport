import type { ReactNode } from "react";
import { PixelArt } from "./PixelArt";
import { CHEST, CLOUD, HOUSE, MASCOT, MOON, SCROLL, STAR, TREE } from "./pixel-art-data";
import { ThemeToggle } from "./ThemeToggle";

/** 日历与图例里用的小图标，统一一个尺寸入口 */
export const Icon = {
  Star: ({ scale = 2, className }: { scale?: number; className?: string }) => <PixelArt bitmap={STAR} scale={scale} className={className} />,
  Scroll: ({ scale = 2, className }: { scale?: number; className?: string }) => <PixelArt bitmap={SCROLL} scale={scale} className={className} />,
  Chest: ({ scale = 2, className }: { scale?: number; className?: string }) => <PixelArt bitmap={CHEST} scale={scale} className={className} />,
};

/** 吉祥物：脚下一块影子，头顶轻轻起伏 */
export function Mascot({ scale = 5 }: { scale?: number }) {
  return (
    <div className="relative shrink-0" aria-hidden>
      <PixelArt bitmap={MASCOT} scale={scale} className="anim-idle relative block" />
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-black/35" style={{ width: scale * 12, height: scale }} />
    </div>
  );
}

/** 稳定哈希：布局看起来随机，但服务端与客户端每次结果一致，不会水合失配 */
function hash(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

/** 星星只出现在夜色未退的左半边天，越往右越稀疏 */
function Stars() {
  return (
    <div className="sky-stars absolute inset-0">
      {Array.from({ length: 46 }, (_, i) => {
        const left = hash(i * 3 + 1) * 56;
        const top = hash(i * 3 + 2) * 70;
        const bright = hash(i * 3 + 3);
        const size = bright > 0.85 ? 4 : 2;
        return (
          <span
            key={i}
            className={bright > 0.7 ? "anim-twinkle absolute" : "absolute"}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              background: "#fffaf0",
              opacity: Math.max(0.15, 1 - left / 56) * (0.35 + bright * 0.65),
              animationDelay: `${-(i % 7) * 0.4}s`,
            }}
          />
        );
      })}
    </div>
  );
}

/** 阶梯状的方块太阳 */
function Sun() {
  const px = 5;
  const rows = [4, 6, 8, 9, 10, 10, 10, 9, 8, 6, 4];
  return (
    <div className="sky-sun absolute" style={{ right: "7%", top: 14, filter: "drop-shadow(0 0 18px rgb(245 215 110 / 0.5))" }}>
      {rows.map((w, i) => (
        <div
          key={i}
          style={{ width: w * px, height: px, marginLeft: ((10 - w) / 2) * px, background: i < 4 ? "#f7e08a" : i < 8 ? "#f5d76e" : "#f2a65a" }}
        />
      ))}
    </div>
  );
}

/** 夜里的月亮，与太阳同一个位置，由主题决定显示哪一个 */
function Moon() {
  return (
    <div className="sky-moon absolute" style={{ right: "7%", top: 16, filter: "drop-shadow(0 0 16px rgb(255 244 194 / 0.45))" }}>
      <PixelArt bitmap={MOON} scale={5} />
    </div>
  );
}

const CLOUDS = [
  { top: 10, scale: 3, duration: 140, delay: 0, opacity: 0.32 },
  { top: 44, scale: 2, duration: 200, delay: -90, opacity: 0.22 },
  { top: 22, scale: 4, duration: 260, delay: -170, opacity: 0.16 },
];

/** 天际线上的小屋与树，沿底边错落排开；窗里的灯是这条剪影里唯一的亮点 */
const SCENERY: { kind: "house" | "tree"; left: number; scale: number }[] = [
  { kind: "tree", left: 1, scale: 4 },
  { kind: "house", left: 6, scale: 4 },
  { kind: "house", left: 13, scale: 3 },
  { kind: "tree", left: 19, scale: 3 },
  { kind: "tree", left: 30, scale: 4 },
  { kind: "house", left: 38, scale: 4 },
  { kind: "tree", left: 46, scale: 3 },
  { kind: "house", left: 55, scale: 3 },
  { kind: "tree", left: 62, scale: 4 },
  { kind: "house", left: 70, scale: 4 },
  { kind: "tree", left: 78, scale: 3 },
  { kind: "house", left: 85, scale: 3 },
  { kind: "tree", left: 93, scale: 4 },
];

/**
 * 填满父容器的天空。父容器需要 relative 并有高度。
 * 白天 / 夜晚两套天色全部走 CSS 变量（见 globals.css 的 data-theme），
 * 所以这里是纯服务端组件，切换主题不需要重新渲染。
 */
export function Sky() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: "var(--sky-gradient)" }}
      />
      <Stars />
      <Sun />
      <Moon />
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className="anim-drift absolute left-0"
          style={{ top: c.top, opacity: `calc(var(--cloud-k) * ${c.opacity})`, animationDuration: `${c.duration}s`, animationDelay: `${c.delay}s` }}
        >
          <PixelArt bitmap={CLOUD} scale={c.scale} />
        </div>
      ))}
      {/* 地平线附近压一层暖光，制造大气透视 */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 45%, var(--sky-glow) 100%)" }} />
      {SCENERY.map((s, i) => (
        <PixelArt key={i} bitmap={s.kind === "house" ? HOUSE : TREE} scale={s.scale} className="absolute bottom-0" style={{ left: `${s.left}%` }} />
      ))}
    </div>
  );
}

/** 天空与地面的交界：受光草皮、背光草皮、泥土三条横带 */
export function HorizonEdge() {
  return (
    <div className="relative w-full" aria-hidden>
      <div className="h-1.5" style={{ background: "var(--grass-top)" }} />
      <div className="h-2.5" style={{ background: "var(--grass-mid)" }} />
      <div className="h-2" style={{ background: "var(--grass-low)" }} />
      <div className="h-1.5" style={{ background: "var(--dirt)" }} />
    </div>
  );
}

/**
 * 每个页面顶部的天空页头：吉祥物站在草地上，旁边是页面标题，右侧放操作区。
 * narrow 用于设置页这类正文较窄的页面，页头要和正文同宽才对得齐。
 * 操作区的控件要自带不透明底（pixel-button / 深色小牌），不能直接把字写在天空上。
 */
export function SiteHeader({ title, tagline, actions, narrow = false }: { title: string; tagline?: string; actions?: ReactNode; narrow?: boolean }) {
  return (
    <header>
      <div className="relative">
        <Sky />
        <div className={`page-shell ${narrow ? "!max-w-4xl" : ""} relative flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-8`}>
          <div className="flex items-end gap-3">
            <Mascot />
            <div className="pb-2">
              {/* pixel-outline 的描边会溢出行盒，行高要留余量 */}
              <h1 className="pixel-outline font-pixel text-2xl leading-[1.5]">{title}</h1>
              {tagline && <p className="mt-1 inline-block border-2 border-ink bg-dusk/90 px-2 text-[13px] leading-6 text-parchment">{tagline}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-3">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </div>
      <HorizonEdge />
    </header>
  );
}

/** 页脚署名：像素字体是 OFL-1.1 许可，需要保留出处 */
export function SiteFooter() {
  return (
    <footer className="site-footer page-shell py-6 text-center text-xs">
      像素字体{" "}
      <a className="underline" href="https://github.com/TakWolf/fusion-pixel-font" target="_blank" rel="noreferrer">
        Fusion Pixel Font
      </a>{" "}
      · OFL-1.1
    </footer>
  );
}
