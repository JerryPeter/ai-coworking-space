// 8x8 pixel-art avatar (spec 5.2 / 5.2.1), drawn as inline SVG squares.
import { identity, pixelCells, subtle } from "../../theme/agents";

export function PixelAvatar({
  id, size = 56, offline = false, tile = true, grayscale,
}: { id: string; size?: number; offline?: boolean; tile?: boolean; grayscale?: number }) {
  const cells = pixelCells(id);
  const isTool = identity(id).kind === "tool";
  // Drawn area: 48/56 of the tile on cards; full size for compact (no tile) contexts.
  const draw = tile ? Math.round((size * 48) / 56) : size;
  const style: React.CSSProperties = {
    width: size, height: size,
    background: tile ? subtle(id) : "transparent",
    filter: grayscale != null ? `grayscale(${grayscale})` : undefined,
  };
  return (
    <span className={`pixel-avatar${isTool ? " tool" : ""}${offline ? " offline" : ""}`} style={style} aria-hidden="true">
      {cells.length ? (
        <svg width={draw} height={draw} viewBox="0 0 8 8">
          {cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill={c.fill} />)}
        </svg>
      ) : (
        <svg width={draw} height={draw} viewBox="0 0 8 8"><rect x={1} y={1} width={6} height={6} fill="var(--text-muted)" /></svg>
      )}
    </span>
  );
}
