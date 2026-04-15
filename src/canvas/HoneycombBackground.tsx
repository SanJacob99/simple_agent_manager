import { useStore } from '@xyflow/react';

type Props = {
  side?: number;
  color?: string;
  strokeWidth?: number;
};

const transformSelector = (s: { transform: [number, number, number] }) => s.transform;

export default function HoneycombBackground({
  side = 14,
  color,
  strokeWidth = 1,
}: Props) {
  const [tx, ty, zoom] = useStore(transformSelector);

  const ss = side * zoom;
  const w = Math.sqrt(3) * ss;
  const h = 3 * ss;
  const halfW = w / 2;

  const hexCenters: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
    [halfW, h / 2],
  ];

  const hexPoints = (cx: number, cy: number) =>
    [
      [cx, cy - ss],
      [cx + halfW, cy - ss / 2],
      [cx + halfW, cy + ss / 2],
      [cx, cy + ss],
      [cx - halfW, cy + ss / 2],
      [cx - halfW, cy - ss / 2],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');

  const patternId = 'honeycomb-pattern';

  return (
    <svg
      className="react-flow__background"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <pattern
        id={patternId}
        x={tx % w}
        y={ty % h}
        width={w}
        height={h}
        patternUnits="userSpaceOnUse"
      >
        {hexCenters.map(([cx, cy], i) => (
          <polygon
            key={i}
            points={hexPoints(cx, cy)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
