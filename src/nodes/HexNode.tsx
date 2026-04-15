import { useId, type ReactNode } from 'react';

export const HEX_WIDTH = 150;
export const HEX_SIDE = HEX_WIDTH / Math.sqrt(3);
export const HEX_HEIGHT = HEX_SIDE * 2;
export const HEX_CORNER_RADIUS = 10;

export function roundedHexPathPointyTop(
  cx: number,
  cy: number,
  side: number,
  radius: number,
): string {
  const halfW = (Math.sqrt(3) * side) / 2;
  const vertices: Array<[number, number]> = [
    [cx, cy - side],
    [cx + halfW, cy - side / 2],
    [cx + halfW, cy + side / 2],
    [cx, cy + side],
    [cx - halfW, cy + side / 2],
    [cx - halfW, cy - side / 2],
  ];
  const n = vertices.length;
  const r = Math.min(radius, side / 2);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const toPrevX = prev[0] - curr[0];
    const toPrevY = prev[1] - curr[1];
    const lenPrev = Math.hypot(toPrevX, toPrevY);
    const beforeX = curr[0] + (toPrevX / lenPrev) * r;
    const beforeY = curr[1] + (toPrevY / lenPrev) * r;

    const toNextX = next[0] - curr[0];
    const toNextY = next[1] - curr[1];
    const lenNext = Math.hypot(toNextX, toNextY);
    const afterX = curr[0] + (toNextX / lenNext) * r;
    const afterY = curr[1] + (toNextY / lenNext) * r;

    parts.push(
      i === 0
        ? `M ${beforeX} ${beforeY}`
        : `L ${beforeX} ${beforeY}`,
    );
    parts.push(`Q ${curr[0]} ${curr[1]} ${afterX} ${afterY}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

const HEX_PATH_DATA = roundedHexPathPointyTop(
  HEX_WIDTH / 2,
  HEX_HEIGHT / 2,
  HEX_SIDE,
  HEX_CORNER_RADIUS,
);

export const HEX_CLIP = `path('${HEX_PATH_DATA}')`;

interface HexNodeProps {
  color: string;
  selected?: boolean;
  children: ReactNode;
  cornerSlot?: ReactNode;
  handles?: ReactNode;
}

export default function HexNode({
  color,
  selected,
  children,
  cornerSlot,
  handles,
}: HexNodeProps) {
  const uid = useId().replace(/:/g, '');
  const clipId = `hex-clip-${uid}`;
  const borderColor = selected ? color : 'var(--c-node-border-default)';
  const accentWidth = HEX_WIDTH * 0.1;

  return (
    <div
      style={{
        position: 'relative',
        width: HEX_WIDTH,
        height: HEX_HEIGHT,
        filter: selected
          ? `drop-shadow(0 0 12px color-mix(in srgb, ${color} 55%, transparent))`
          : 'drop-shadow(0 4px 10px var(--c-node-shadow))',
      }}
    >
      <svg
        width={HEX_WIDTH}
        height={HEX_HEIGHT}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <defs>
          <clipPath id={clipId}>
            <path d={HEX_PATH_DATA} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path d={HEX_PATH_DATA} fill="var(--c-slate-900)" />
          <rect x={0} y={0} width={accentWidth} height={HEX_HEIGHT} fill={color} />
          <path
            d={HEX_PATH_DATA}
            fill="none"
            stroke={borderColor}
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '34px 18px',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
      {cornerSlot && (
        <div
          style={{
            position: 'absolute',
            top: HEX_HEIGHT * 0.22,
            right: HEX_WIDTH * 0.08,
            pointerEvents: 'auto',
          }}
        >
          {cornerSlot}
        </div>
      )}
      {handles}
    </div>
  );
}
