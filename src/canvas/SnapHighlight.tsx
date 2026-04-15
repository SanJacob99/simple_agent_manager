import { useStore } from '@xyflow/react';
import {
  HEX_CORNER_RADIUS,
  HEX_SIDE,
  roundedHexPathPointyTop,
} from '../nodes/HexNode';

type Props = {
  center: { x: number; y: number } | null;
  color: string | null;
};

const transformSelector = (s: { transform: [number, number, number] }) =>
  s.transform;

export default function SnapHighlight({ center, color }: Props) {
  const [tx, ty, zoom] = useStore(transformSelector);

  if (!center || !color) return null;

  const ss = HEX_SIDE * zoom;
  const cx = tx + center.x * zoom;
  const cy = ty + center.y * zoom;
  const radius = HEX_CORNER_RADIUS * zoom;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <path
        d={roundedHexPathPointyTop(cx, cy, ss, radius)}
        fill={color}
        fillOpacity={0.22}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
