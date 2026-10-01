import type { RequestRecord } from "./local-store.js";

const fields = ["inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningTokens", "costEstimateUsd", "ttftMs"] as const;
type Field = typeof fields[number];
export type UsageDay = {
  day: string;
  requests: number;
  errors: number;
  durationMs: number;
  durationKnown: number;
  measurements: Record<Field, { sum: number; known: number }>;
};
export type UsageLedger = {
  version: 1;
  coverage: "since-store-created" | "retained-history-plus-new" | "since-reset";
  trackingStartedAt: string;
  days: UsageDay[];
};

export function newUsageLedger(legacy: boolean): UsageLedger {
  return { version: 1, coverage: legacy ? "retained-history-plus-new" : "since-store-created", trackingStartedAt: new Date().toISOString(), days: [] };
}

export function accumulateUsage(ledger: UsageLedger, record: RequestRecord): void {
  // Use the request timestamp, not migration time; malformed dates must not
  // create arbitrary bucket names or silently inflate today's totals.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(record.at) || !Number.isFinite(Date.parse(record.at))) throw new Error("Invalid usage timestamp");
  const day = new Date(record.at).toISOString().slice(0, 10);
  let bucket = ledger.days.find((item) => item.day === day);
  if (!bucket) {
    bucket = { day, requests: 0, errors: 0, durationMs: 0, durationKnown: 0,
      measurements: Object.fromEntries(fields.map((field) => [field, { sum: 0, known: 0 }])) as UsageDay["measurements"] };
    ledger.days.push(bucket);
  }
  bucket.requests++;
  if (record.status >= 400 || record.outcome === "failed" || record.outcome === "cancelled") bucket.errors++;
  if (Number.isFinite(record.durationMs) && record.durationMs >= 0) { bucket.durationMs += record.durationMs; bucket.durationKnown++; }
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    if (field.endsWith("Tokens") && !Number.isSafeInteger(value)) continue;
    bucket.measurements[field].sum += value;
    bucket.measurements[field].known++;
  }
}

export function usageReport(ledger: UsageLedger) {
  return { ...ledger, timezone: "UTC", days: ledger.days.slice().sort((a, b) => b.day.localeCompare(a.day)).map((day) => ({
    day: day.day, requests: day.requests, errors: day.errors,
    averageLatencyMs: day.durationKnown ? Math.round(day.durationMs / day.durationKnown) : null,
    latencyKnown: day.durationKnown,
    measurements: Object.fromEntries(fields.map((field) => {
      const value = day.measurements[field];
      return [field, { sum: value.known ? value.sum : null, known: value.known, unknown: day.requests - value.known }];
    })),
  })) };
}
