import { createHash } from "node:crypto";

type Bucket = { starts: number[]; active: number };
export type LimitResult = { allowed: true; release: () => void } | { allowed: false; retryAfter: number; reason: "rate" | "concurrency" | "capacity" };

/** Single-process admission control. Credentials are represented only by hashes. */
export class RequestLimits {
  private readonly buckets = new Map<string, Bucket>();
  constructor(public requestsPerMinute = 60, public concurrentRequests = 4, private readonly maxKeys = 10_000, private readonly now = Date.now) {
    for (const value of [requestsPerMinute, concurrentRequests, maxKeys]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Request limits must be positive safe integers.");
    }
  }
  configure(requestsPerMinute: number, concurrentRequests: number): void {
    for (const value of [requestsPerMinute, concurrentRequests]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Request limits must be positive safe integers.");
    }
    // Retain active leases and minute history when administrators change policy.
    this.requestsPerMinute = requestsPerMinute;
    this.concurrentRequests = concurrentRequests;
  }
  acquire(token: string): LimitResult {
    const time = this.now();
    const key = createHash("sha256").update(token).digest("hex");
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        for (const [id, entry] of this.buckets) {
          if (!entry.active && (!entry.starts.length || entry.starts[entry.starts.length - 1] <= time - 60_000)) this.buckets.delete(id);
        }
      }
      if (this.buckets.size >= this.maxKeys) return { allowed: false, reason: "capacity", retryAfter: 60 };
      bucket = { starts: [], active: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.starts = bucket.starts.filter((started) => started > time - 60_000);
    if (bucket.active >= this.concurrentRequests) return { allowed: false, reason: "concurrency", retryAfter: 1 };
    if (bucket.starts.length >= this.requestsPerMinute) return { allowed: false, reason: "rate", retryAfter: Math.max(1, Math.ceil((bucket.starts[0] + 60_000 - time) / 1000)) };
    bucket.starts.push(time);
    bucket.active++;
    let released = false;
    return { allowed: true, release: () => { if (!released) { released = true; bucket.active--; } } };
  }
}
