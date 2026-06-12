'use client';

import { useEffect, useState } from 'react';

interface HalfGaugeProps {
  /** 0..1 */
  value: number;
  label: string;
  /** Big text in the middle (e.g. "94%"). Defaults to value as a percent. */
  display?: string;
  sublabel?: string;
  color?: string;
  size?: number;
}

/**
 * Semicircular gauge — a half-round progress arc that sweeps in on mount.
 */
export function HalfGauge({ value, label, display, sublabel, color = '#3b82f6', size = 160 }: HalfGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  // Animate from 0 on mount by flipping the dashoffset after first paint
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimated(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  const stroke = size * 0.085;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const arcLen = Math.PI * r;
  const height = size / 2 + stroke;

  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} className="block">
        <path
          d={arcPath}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={arcPath}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          strokeDashoffset={arcLen * (1 - animated)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        <text
          x={cx}
          y={cy - size * 0.04}
          textAnchor="middle"
          className="fill-gray-900 font-bold"
          fontSize={size * 0.17}
        >
          {display ?? `${Math.round(clamped * 100)}%`}
        </text>
        {sublabel && (
          <text
            x={cx}
            y={cy + size * 0.09}
            textAnchor="middle"
            className="fill-gray-400"
            fontSize={size * 0.07}
          >
            {sublabel}
          </text>
        )}
      </svg>
      <div className="text-sm font-medium text-gray-600 -mt-1">{label}</div>
    </div>
  );
}
