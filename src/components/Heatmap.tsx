import { useMemo, useState } from "react";
import type { HeatmapDay } from "../types";
import { formatDuration, friendlyDate } from "../lib/format";

type Props = {
  days: HeatmapDay[];
  compact?: boolean;
};

const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

export function Heatmap({ days, compact = false }: Props) {
  const [hovered, setHovered] = useState<HeatmapDay | null>(null);
  const visibleDays = useMemo(() => days.slice(compact ? -168 : -364), [days, compact]);
  const weeks = Math.ceil(visibleDays.length / 7);

  const monthLabels = useMemo(() => {
    const labels: { label: string; col: number }[] = [];
    let previous = "";
    visibleDays.forEach((day, index) => {
      const label = new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${day.date}T12:00:00`));
      if (label !== previous && index > 6) labels.push({ label, col: Math.floor(index / 7) });
      previous = label;
    });
    return labels;
  }, [visibleDays]);

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {monthLabels.map((month) => (
          <span key={`${month.label}-${month.col}`} style={{ gridColumn: month.col + 1 }}>
            {month.label}
          </span>
        ))}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-days">
          {dayLabels.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(8px, 1fr))` }}>
          {visibleDays.map((day) => {
            const level = day.seconds === 0 ? 0 : day.seconds < 3600 ? 1 : day.seconds < 3 * 3600 ? 2 : day.seconds < 6 * 3600 ? 3 : 4;
            return (
              <button
                type="button"
                className={`heat-cell heat-${level}`}
                key={day.date}
                aria-label={`${friendlyDate(day.date)}: ${formatDuration(day.seconds)}`}
                onMouseEnter={() => setHovered(day)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(day)}
                onBlur={() => setHovered(null)}
              />
            );
          })}
        </div>
      </div>
      <div className="heatmap-footer">
        <span>{hovered ? `${friendlyDate(hovered.date)} · ${formatDuration(hovered.seconds)}` : "Every focused minute, counted locally"}</span>
        <div className="heat-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i className={`heat-cell heat-${level}`} key={level} />)}<span>More</span></div>
      </div>
    </div>
  );
}
