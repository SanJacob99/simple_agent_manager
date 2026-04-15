import { useId, type ReactNode } from 'react';
import { roundedHexPathPointyTop } from './HexNode';

interface HexHintProps {
  size?: number;
  color: string;
  bg?: string;
  title?: string;
  children?: ReactNode;
  /** Optional fill level 0-1, renders as a bottom-up gauge inside the hex. */
  fillLevel?: number;
}

export default function HexHint({
  size = 18,
  color,
  bg,
  title,
  children,
  fillLevel,
}: HexHintProps) {
  const side = size / Math.sqrt(3);
  const height = side * 2;
  const path = roundedHexPathPointyTop(size / 2, height / 2, side, 2);
  const bgFill = bg ?? `color-mix(in srgb, ${color} 22%, var(--c-slate-900))`;
  const uid = useId().replace(/:/g, '');
  const clipId = `hex-hint-clip-${uid}`;

  const clamped =
    fillLevel === undefined ? null : Math.max(0, Math.min(1, fillLevel));

  return (
    <div
      title={title}
      style={{
        position: 'relative',
        width: size,
        height,
        display: 'inline-block',
        pointerEvents: 'auto',
      }}
    >
      <svg
        width={size}
        height={height}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <defs>
          <clipPath id={clipId}>
            <path d={path} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x={0} y={0} width={size} height={height} fill={bgFill} />
          {clamped !== null && clamped > 0 && (
            <rect
              x={0}
              y={height * (1 - clamped)}
              width={size}
              height={height * clamped}
              fill={color}
              opacity={0.85}
            />
          )}
        </g>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: clamped !== null ? 'var(--c-slate-100)' : color,
          fontSize: 8,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          pointerEvents: 'none',
          textShadow:
            clamped !== null ? '0 0 2px rgba(0,0,0,0.8)' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
