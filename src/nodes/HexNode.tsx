import { type ReactNode } from 'react';

export const HEX_CLIP =
  'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

export const HEX_WIDTH = 150;
export const HEX_SIDE = HEX_WIDTH / Math.sqrt(3);
export const HEX_HEIGHT = HEX_SIDE * 2;

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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: HEX_CLIP,
          background: selected ? color : 'var(--c-node-border-default)',
          padding: 2,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            clipPath: HEX_CLIP,
            background: `linear-gradient(180deg, color-mix(in srgb, ${color} 14%, var(--c-slate-900)) 0%, var(--c-slate-900) 55%)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '34px 18px',
            textAlign: 'center',
          }}
        >
          {children}
        </div>
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
