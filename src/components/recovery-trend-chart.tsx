import { formatCurrency } from "@/lib/format";
import type { RecoveryTrend } from "@/domain/recovery-trend";

const TIME_ZONE = "Asia/Kolkata";

function formatPointTime(timestamp: string, granularity: RecoveryTrend["granularity"]) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    ...(granularity === "hour"
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" }),
  }).format(new Date(timestamp));
}

export function RecoveryTrendChart({ trend }: { trend: RecoveryTrend }) {
  if (trend.points.length === 0) {
    return (
      <article className="panel recovery-trend-panel">
        <div className="panel-header">
          <div>
            <h2>Recovered revenue over time</h2>
            <p>Confirmed payment-success events, accumulated over time</p>
          </div>
        </div>
        <div className="trend-empty" role="status">
          <strong>No recovered payments yet.</strong>
          <span>The first confirmed success will start this trend.</span>
        </div>
      </article>
    );
  }

  const maxValue = Math.max(trend.totalRecoveredPaisa, 1);
  const coordinates = trend.points.map((point, index) => ({
    x: trend.points.length === 1 ? 50 : 2 + (index / (trend.points.length - 1)) * 96,
    y: 92 - (point.recoveredPaisa / maxValue) * 84,
    point,
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const areaPath = `${linePath} L ${coordinates.at(-1)!.x} 92 L ${coordinates[0]!.x} 92 Z`;
  const axisPoints = coordinates.filter(
    (_, index) =>
      index === 0 ||
      index === coordinates.length - 1 ||
      index === Math.floor(coordinates.length / 2),
  );

  return (
    <article className="panel recovery-trend-panel">
      <div className="panel-header trend-panel-header">
        <div>
          <h2>Recovered revenue over time</h2>
          <p>Confirmed payment-success events, accumulated over the observed workflow</p>
        </div>
        <div className="trend-total">
          <span>{trend.eventCount} successful payment events</span>
          <strong>{formatCurrency(trend.totalRecoveredPaisa)}</strong>
        </div>
      </div>

      <figure className="trend-figure">
        <div className="trend-legend" aria-hidden="true">
          <span className="trend-legend-line" /> Cumulative recovered
          <span className="trend-granularity">
            {trend.granularity === "hour" ? "Hourly" : "Daily"}
          </span>
        </div>

        <div className="trend-plot-layout">
          <div className="trend-y-axis" aria-hidden="true">
            <span>{formatCurrency(maxValue, true)}</span>
            <span>{formatCurrency(maxValue / 2, true)}</span>
            <span>₹0</span>
          </div>
          <div>
            <div className="trend-plot">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-labelledby="recovery-trend-title recovery-trend-description"
              >
                <title id="recovery-trend-title">Cumulative recovered revenue</title>
                <desc id="recovery-trend-description">
                  {trend.eventCount} confirmed payment successes recovered{" "}
                  {formatCurrency(trend.totalRecoveredPaisa)}.
                </desc>
                <line className="trend-grid-line" x1="0" x2="100" y1="8" y2="8" />
                <line className="trend-grid-line" x1="0" x2="100" y1="50" y2="50" />
                <line className="trend-grid-line" x1="0" x2="100" y1="92" y2="92" />
                <path className="trend-area" d={areaPath} />
                <path className="trend-line" d={linePath} />
              </svg>
              {coordinates.map(({ x, y, point }) => (
                <span
                  className={`trend-point-target ${y > 50 ? "trend-point-lower" : ""}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  tabIndex={0}
                  role="img"
                  aria-label={`${formatPointTime(point.timestamp, trend.granularity)}: ${formatCurrency(point.recoveredPaisa)} cumulative recovered`}
                  key={point.timestamp}
                >
                  <span className="trend-point" aria-hidden="true" />
                  <span className="trend-tooltip" aria-hidden="true">
                    <strong>{formatCurrency(point.recoveredPaisa)}</strong>
                    <small>{formatPointTime(point.timestamp, trend.granularity)}</small>
                  </span>
                </span>
              ))}
            </div>
            <div className="trend-x-axis" aria-hidden="true">
              {axisPoints.map(({ x, point }) => (
                <span style={{ left: `${x}%` }} key={point.timestamp}>
                  {formatPointTime(point.timestamp, trend.granularity)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <figcaption>
          <details className="trend-data-details">
            <summary>View exact chart data</summary>
            <div className="trend-data-table-wrap">
              <table className="trend-data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>New recovery</th>
                    <th>Cumulative recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.points.map((point) => (
                    <tr key={point.timestamp}>
                      <td>{formatPointTime(point.timestamp, trend.granularity)}</td>
                      <td>
                        {point.incrementalPaisa ? formatCurrency(point.incrementalPaisa) : "—"}
                      </td>
                      <td>{formatCurrency(point.recoveredPaisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figcaption>
      </figure>
    </article>
  );
}
