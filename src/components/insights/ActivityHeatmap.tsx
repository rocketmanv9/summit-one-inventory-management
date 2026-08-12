'use client';

import { useMemo } from 'react';

interface HeatmapDay {
  date: string;
  value: number;
}

// GitHub contribution-graph palette, lightest to darkest
const PALETTE = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CELL = 11;
const GAP = 3;

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * GitHub-style activity heatmap: 53 weeks of daily counting activity,
 * Sunday-aligned columns, rendered as a single SVG.
 */
export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  const { weeks, monthLabels, maxValue, total } = useMemo(() => {
    const valueByDate = new Map(days.map(d => [d.date, d.value]));

    // End on today, start 52 weeks back aligned to Sunday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - 52 * 7);

    const weeks: { date: Date; dateStr: string; value: number; inRange: boolean }[][] = [];
    const monthLabels: { weekIdx: number; label: string }[] = [];
    let lastMonth = -1;

    const cursor = new Date(start);
    while (cursor <= today || cursor.getDay() !== 0) {
      if (cursor.getDay() === 0) {
        weeks.push([]);
        if (cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth();
          monthLabels.push({ weekIdx: weeks.length - 1, label: MONTH_SHORT[lastMonth] });
        }
      }
      const dateStr = localDateStr(cursor);
      weeks[weeks.length - 1].push({
        date: new Date(cursor),
        dateStr,
        value: valueByDate.get(dateStr) || 0,
        inRange: cursor <= today,
      });
      cursor.setDate(cursor.getDate() + 1);
      if (weeks.length > 54) break;
    }

    const maxValue = Math.max(1, ...days.map(d => d.value));
    const total = days.reduce((s, d) => s + d.value, 0);
    return { weeks, monthLabels, maxValue, total };
  }, [days]);

  const colorFor = (value: number, inRange: boolean): string => {
    if (!inRange) return 'transparent';
    if (value === 0) return PALETTE[0];
    const bucket = Math.min(4, 1 + Math.floor((value / maxValue) * 3.999));
    return PALETTE[bucket];
  };

  const width = weeks.length * (CELL + GAP) + 30;
  const height = 7 * (CELL + GAP) + 20;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block">
        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text
            key={`${m.label}-${i}`}
            x={30 + m.weekIdx * (CELL + GAP)}
            y={10}
            className="fill-gray-400"
            fontSize={9}
          >
            {m.label}
          </text>
        ))}

        {/* Day labels */}
        {[['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([label, row]) => (
          <text
            key={label as string}
            x={0}
            y={20 + (row as number) * (CELL + GAP) + CELL - 2}
            className="fill-gray-400"
            fontSize={9}
          >
            {label}
          </text>
        ))}

        {/* Cells */}
        {weeks.map((week, wi) =>
          week.map((day, di) => (
            <rect
              key={day.dateStr}
              x={30 + wi * (CELL + GAP)}
              y={16 + di * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={colorFor(day.value, day.inRange)}
            >
              {day.inRange && (
                <title>{`${day.dateStr}: ${day.value} item${day.value === 1 ? '' : 's'} counted`}</title>
              )}
            </rect>
          ))
        )}
      </svg>

      <div className="flex items-center justify-between mt-1 pr-2">
        <span className="text-xs text-gray-500">{total.toLocaleString()} items counted in the last year</span>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          Less
          {PALETTE.map(c => (
            <span key={c} className="inline-block w-[10px] h-[10px] rounded-sm" style={{ backgroundColor: c }} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}
