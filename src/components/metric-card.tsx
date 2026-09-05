import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  featured = false,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  featured?: boolean;
  trend?: { direction: "up" | "down"; label: string };
}) {
  const Trend = trend?.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <article className={`metric-card ${featured ? "metric-featured" : ""}`}>
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">
          <Icon aria-hidden="true" size={17} />
        </span>
      </div>
      <p className="metric-value">{value}</p>
      <div className="metric-detail">
        {trend ? (
          <span className={`metric-trend metric-trend-${trend.direction}`}>
            <Trend aria-hidden="true" size={14} /> {trend.label}
          </span>
        ) : null}
        <span>{detail}</span>
      </div>
    </article>
  );
}
