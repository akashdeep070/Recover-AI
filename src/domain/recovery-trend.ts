const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_INTERVALS = 12;

export interface RecoveryObservation {
  occurredAt: Date | string;
  amountPaisa: number;
}

export interface RecoveryTrendPoint {
  timestamp: string;
  recoveredPaisa: number;
  incrementalPaisa: number;
}

export interface RecoveryTrend {
  granularity: "hour" | "day";
  eventCount: number;
  totalRecoveredPaisa: number;
  points: RecoveryTrendPoint[];
}

function timestamp(value: Date | string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildRecoveryTrend(
  observations: RecoveryObservation[],
  observedStartAt?: Date | string,
): RecoveryTrend {
  const events = observations
    .map((item) => ({ at: timestamp(item.occurredAt), amountPaisa: item.amountPaisa }))
    .filter(
      (item): item is { at: number; amountPaisa: number } =>
        item.at !== undefined && Number.isFinite(item.amountPaisa) && item.amountPaisa > 0,
    )
    .sort((a, b) => a.at - b.at);

  if (events.length === 0) {
    return { granularity: "hour", eventCount: 0, totalRecoveredPaisa: 0, points: [] };
  }

  const lastEventAt = events.at(-1)!.at;
  const requestedStart = timestamp(observedStartAt);
  const naturalStart = Math.min(requestedStart ?? events[0]!.at, events[0]!.at);
  const granularity = lastEventAt - naturalStart <= 36 * HOUR_MS ? "hour" : "day";
  const baseStep = granularity === "hour" ? HOUR_MS : DAY_MS;
  const rawIntervals = Math.max(1, Math.ceil((lastEventAt - naturalStart) / baseStep));
  const step = baseStep * Math.max(1, Math.ceil(rawIntervals / MAX_INTERVALS));
  const end = Math.ceil(lastEventAt / step) * step;
  const earliestAllowed = end - MAX_INTERVALS * step;
  const requestedBucketStart = Math.floor(naturalStart / step) * step;
  const start = Math.min(end - 3 * step, Math.max(requestedBucketStart, earliestAllowed));

  let runningTotal = 0;
  let eventIndex = 0;
  let previousTotal = 0;
  const points: RecoveryTrendPoint[] = [];

  for (let at = start; at <= end; at += step) {
    while (eventIndex < events.length && events[eventIndex]!.at <= at) {
      runningTotal += events[eventIndex]!.amountPaisa;
      eventIndex += 1;
    }
    points.push({
      timestamp: new Date(at).toISOString(),
      recoveredPaisa: runningTotal,
      incrementalPaisa: runningTotal - previousTotal,
    });
    previousTotal = runningTotal;
  }

  return {
    granularity,
    eventCount: events.length,
    totalRecoveredPaisa: events.reduce((sum, item) => sum + item.amountPaisa, 0),
    points,
  };
}
