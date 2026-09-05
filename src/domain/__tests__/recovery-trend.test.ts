import { describe, expect, it } from "vitest";
import { buildRecoveryTrend } from "../recovery-trend";

describe("recovery trend", () => {
  it("builds a sorted hourly cumulative series from observed success events", () => {
    const trend = buildRecoveryTrend(
      [
        { occurredAt: "2026-08-23T15:00:00.000Z", amountPaisa: 1_499_900 },
        { occurredAt: "2026-08-23T12:00:00.000Z", amountPaisa: 999_900 },
      ],
      "2026-08-23T09:00:00.000Z",
    );

    expect(trend.granularity).toBe("hour");
    expect(trend.eventCount).toBe(2);
    expect(trend.points).toHaveLength(7);
    expect(trend.points.map((point) => point.recoveredPaisa)).toEqual([
      0, 0, 0, 999_900, 999_900, 999_900, 2_499_800,
    ]);
    expect(trend.totalRecoveredPaisa).toBe(2_499_800);
  });

  it("switches to daily aggregation and caps long histories", () => {
    const trend = buildRecoveryTrend(
      [
        { occurredAt: "2026-08-01T10:00:00.000Z", amountPaisa: 100_000 },
        { occurredAt: "2026-08-24T10:00:00.000Z", amountPaisa: 200_000 },
      ],
      "2026-08-01T00:00:00.000Z",
    );

    expect(trend.granularity).toBe("day");
    expect(trend.points.length).toBeLessThanOrEqual(13);
    expect(trend.points.at(-1)?.recoveredPaisa).toBe(300_000);
  });

  it("ignores malformed and non-positive observations", () => {
    const trend = buildRecoveryTrend([
      { occurredAt: "not-a-date", amountPaisa: 100_000 },
      { occurredAt: "2026-08-23T12:00:00.000Z", amountPaisa: 0 },
    ]);

    expect(trend).toMatchObject({ eventCount: 0, totalRecoveredPaisa: 0, points: [] });
  });
});
