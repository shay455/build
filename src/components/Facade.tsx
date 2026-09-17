import type { Property } from '@/types/property';

/** Deterministic per-property jitter, so a card looks the same on every render. */
function seeded(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return () => {
    h = (h * 1103515245 + 12345) | 0;
    return ((h >>> 16) & 0x7fff) / 0x7fff;
  };
}

/**
 * A schematic elevation drawn from the property's own data, with its floor picked out.
 * A broker photograph is a persuasion device; this is the building as the record describes it.
 */
export function Facade({ property: p }: { property: Property }) {
  const rnd = seeded(p.id + p.street);
  const floors = Math.max(2, p.floorsInBuilding);
  const cols = p.assetType === 'house' ? 3 : Math.min(6, Math.max(3, Math.round(p.sqm / 22)));
  const W = 320;
  const H = 180;
  const bw = Math.min(250, 40 + cols * 34);
  const bh = Math.min(140, 30 + floors * 16);
  const bx = (W - bw) / 2;
  const by = H - bh - 12;
  const fh = bh / floors;
  const cw = bw / cols;
  const myFloor = Math.min(floors - 1, Math.max(0, p.floor));

  const windows: React.ReactElement[] = [];
  for (let f = 0; f < floors; f++) {
    const isMine = f === myFloor;
    for (let c = 0; c < cols; c++) {
      const lit = isMine || rnd() > 0.55;
      windows.push(
        <rect
          key={`w-${f}-${c}`}
          x={bx + c * cw + cw * 0.22}
          y={by + bh - (f + 1) * fh + fh * 0.25}
          width={cw * 0.56}
          height={fh * 0.5}
          rx={1}
          fill={isMine ? 'var(--color-accent)' : lit ? 'var(--color-accent-soft)' : 'var(--color-surface-2)'}
          stroke="var(--color-line-2)"
          strokeWidth={0.8}
        />,
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-full w-full"
      role="img"
      aria-label={`איור סכמטי של הבניין: ${floors} קומות, הדירה בקומה ${p.floor === 0 ? 'הקרקע' : p.floor}`}
    >
      <rect x={0} y={0} width={W} height={H} fill="var(--color-surface-3)" />
      <rect x={0} y={H - 12} width={W} height={12} fill="var(--color-line)" />
      <rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        fill="var(--color-surface)"
        stroke="var(--color-line)"
        strokeWidth={1.5}
      />
      {windows}
      <rect
        x={bx + 1}
        y={by + bh - (myFloor + 1) * fh + 1}
        width={bw - 2}
        height={fh - 2}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.4}
        strokeDasharray="3 2"
      />
      {(p.assetType === 'house' || p.assetType === 'garden') && (
        <rect x={bx - 16} y={H - 20} width={bw + 32} height={8} rx={3} fill="var(--color-accent-soft)" />
      )}
    </svg>
  );
}
