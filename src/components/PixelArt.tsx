import type { CSSProperties, ReactNode } from "react";
import type { Bitmap } from "./pixel-art-data";

/**
 * 像素画渲染：把位图画成一张 SVG，每个像素一个 <rect>。
 *
 * 同一行里连续同色的像素合并成一个矩形，节点数少一个数量级；
 * shapeRendering="crispEdges" 保证放大后边缘不会被抗锯齿糊开。
 * 尺寸取整数倍，非整数倍缩放会让像素大小不一致。
 */
export function PixelArt({
  bitmap,
  scale = 3,
  className,
  style,
  title,
}: {
  bitmap: Bitmap;
  /** 一个源像素显示为多少个 CSS 像素 */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  /** 有意义的图给出文字说明；纯装饰的图留空，会对读屏软件隐藏 */
  title?: string;
}) {
  const { rows, palette } = bitmap;
  const width = rows[0].length;
  const rects: ReactNode[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < width) {
      const ch = row[x];
      let end = x + 1;
      while (end < width && row[end] === ch) end++;
      if (ch !== ".") rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={end - x} height={1} style={{ fill: palette[ch] }} />);
      x = end;
    }
  });
  return (
    <svg
      width={width * scale}
      height={rows.length * scale}
      viewBox={`0 0 ${width} ${rows.length}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {rects}
    </svg>
  );
}
