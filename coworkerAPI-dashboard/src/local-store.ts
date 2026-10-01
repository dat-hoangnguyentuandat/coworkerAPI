import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProviderSecrets, type EncryptedProviderSecret } from "./provider-secrets.js";
import { accumulateUsage, newUsageLedger, usageReport, type UsageLedger } from "./usage-ledger.js";

export type ProviderRecord = {
  id: string;
  name: string;
  type: "coworker-widget" | "openai" | "anthropic" | "openai-compatible";
  baseUrl?: string;
  wireApi?: "responses" | "chat-completions";
  enabled: boolean;
};
type StoredProvider = ProviderRecord & { credential?: EncryptedProviderSecret };

export type ManagedKey = {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type ModelAlias = {
  id: string;
  provider: string;
  upstreamModel: string;
  enabled: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
};

export type RequestRecord = {
  id: string;
  at: string;
  protocol: string;
  model?: string;
  status: number;
  durationMs: number;
  /** Time spent waiting before the selected bridge started inference. */
  queueMs?: number | null;
  /** Time spent in the bridge, including the ChatGPT/widget callback. */
  inferenceMs?: number | null;
  provider?: string | null;
  upstreamModel?: string | null;
  outcome?: "unknown" | "completed" | "failed" | "cancelled" | "rejected";
  ttftMs?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  usageSource?: "upstream" | "unknown";
  costEstimateUsd?: number | null;
};

type LocalData = {
  version: 1;
  adminPassword?: { salt: string; hash: string };
  keys: ManagedKey[];
  models: ModelAlias[];
  requests: RequestRecord[];
  usage?: UsageLedger;
  providers?: StoredProvider[];
  limits?: { requestsPerMinute: number; concurrentRequests: number };
};

function digest(secret: string): string { return createHash("sha256").update(secret).digest("hex"); }
function passwordHash(password: string, salt: string): string { return scryptSync(password, salt, 64).toString("hex"); }
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

/** Single-process, atomic local persistence for the installable test build. */
export class LocalStore {
  private changeRevision = 0;
  get revision(): number { return this.changeRevision; }
  private data: LocalData;
  constructor(readonly file: string, private readonly masterEncryptionKey = process.env.MASTER_ENCRYPTION_KEY) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as LocalData;
      if (parsed.version !== 1 || !Array.isArray(parsed.keys) || !Array.isArray(parsed.models) || !Array.isArray(parsed.requests)) throw new Error("Unsupported or invalid CoworkerAPI data file");
      this.data = parsed;
      if (!this.data.usage) {
        this.data.usage = newUsageLedger(true);
        for (const record of this.data.requests) accumulateUsage(this.data.usage, record);
        this.save();
      }
    } else {
      this.data = { version: 1, keys: [], models: [{ id: "chatgpt-web", provider: "coworker-widget", upstreamModel: "chatgpt-web", enabled: true, supportsTools: true, supportsStreaming: true }], requests: [], usage: newUsageLedger(false) };
      this.save();
    }
  }

  listProviders(): Array<ProviderRecord & { hasCredential: boolean }> {
    return (this.data.providers ?? []).map(({ credential, ...provider }) => ({ ...provider, hasCredential: Boolean(credential) }));
  }
  upsertProvider(provider: ProviderRecord, apiKey?: string): void {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(provider.id) || !provider.name.trim() || provider.name.length > 120) throw new Error("Invalid provider metadata.");
    if (!["coworker-widget", "openai", "anthropic", "openai-compatible"].includes(provider.type)) throw new Error("Invalid provider type.");
    if (provider.type !== "coworker-widget") {
      if (!provider.baseUrl) throw new Error("Provider base URL is required.");
      const url = new URL(provider.baseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid provider base URL.");
    }
    const providers = this.data.providers ?? [];
    const existing = providers.find((item) => item.id === provider.id);
    const credential = apiKey === undefined ? existing?.credential : new ProviderSecrets(this.masterEncryptionKey).encrypt(provider.id, apiKey);
    if (provider.type !== "coworker-widget" && !credential) throw new Error("Provider credential is required.");
    // Select metadata explicitly; runtime callers must never persist an extra
    // apiKey/password property accidentally attached to a typed object.
    const record: StoredProvider = {
      id: provider.id, name: provider.name.trim(), type: provider.type,
      baseUrl: provider.baseUrl, wireApi: provider.wireApi,
      enabled: provider.enabled, credential,
    };
    const index = providers.findIndex((item) => item.id === provider.id);
    if (index < 0) providers.push(record);
    else providers[index] = record;
    this.data.providers = providers;
    this.save();
  }
  providerKey(id: string): string | undefined {
    const provider = this.data.providers?.find((item) => item.id === id && item.enabled);
    return provider?.credential ? new ProviderSecrets(this.masterEncryptionKey).decrypt(id, provider.credential) : undefined;
  }

  get initialized(): boolean { return Boolean(this.data.adminPassword); }
  getLimits(): { requestsPerMinute: number; concurrentRequests: number } | undefined {
    return this.data.limits ? { ...this.data.limits } : undefined;
  }
  setLimits(limits: { requestsPerMinute: number; concurrentRequests: number }): void {
    if (!Number.isSafeInteger(limits.requestsPerMinute) || limits.requestsPerMinute < 1 || limits.requestsPerMinute > 100_000
      || !Number.isSafeInteger(limits.concurrentRequests) || limits.concurrentRequests < 1 || limits.concurrentRequests > 1000) throw new Error("Invalid admission limits.");
    this.data.limits = { ...limits };
    this.save();
  }
  setup(password: string): boolean {
    if (this.initialized) return false;
    if (password.length < 6 || password.length > 256) throw new Error("Admin password must be 6–256 characters");
    const salt = randomBytes(24).toString("hex");
    this.data.adminPassword = { salt, hash: passwordHash(password, salt) };
    this.save();
    return true;
  }
  verifyPassword(password: string): boolean {
    const stored = this.data.adminPassword;
    return Boolean(stored && safeEqual(passwordHash(password, stored.salt), stored.hash));
  }

  listKeys(): Omit<ManagedKey, "hash">[] { return this.data.keys.map(({ hash: _hash, ...key }) => ({ ...key })); }
  createKey(name: string): { key: string; record: Omit<ManagedKey, "hash"> } {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new Error("Key name must be 1–80 characters");
    const key = `cwapi_${randomBytes(32).toString("base64url")}`;
    const record: ManagedKey = { id: randomUUID(), name: trimmed, prefix: key.slice(0, 14), hash: digest(key), createdAt: new Date().toISOString() };
    this.data.keys.push(record);
    this.save();
    const { hash: _hash, ...publicRecord } = record;
    return { key, record: publicRecord };
  }
  revokeKey(id: string): boolean {
    const key = this.data.keys.find((item) => item.id === id && !item.revokedAt);
    if (!key) return false;
    key.revokedAt = new Date().toISOString();
    this.save();
    return true;
  }
  verifyKey(secret: string): boolean {
    const actual = digest(secret);
    let matched = false;
    for (const key of this.data.keys) {
      if (!key.revokedAt && safeEqual(actual, key.hash)) {
        key.lastUsedAt = new Date().toISOString();
        matched = true;
      }
    }
    if (matched) this.save();
    return matched;
  }

  listModels(): ModelAlias[] { return this.data.models.map((model) => ({ ...model })); }
  upsertModel(model: ModelAlias): void {
    const index = this.data.models.findIndex((item) => item.id === model.id);
    if (index < 0) this.data.models.push({ ...model });
    else this.data.models[index] = { ...model };
    this.save();
  }

  recordRequest(record: RequestRecord): void {
    accumulateUsage(this.data.usage!, record);
    // Explicit allowlist: callers cannot accidentally persist raw request,
    // response, error body, headers or credentials attached to this object.
    this.data.requests.push({ id: record.id, at: record.at, protocol: record.protocol,
      model: record.model, status: record.status, durationMs: record.durationMs,
      provider: record.provider ?? null, upstreamModel: record.upstreamModel ?? null,
      outcome: record.outcome ?? "unknown", ttftMs: record.ttftMs ?? null,
      inputTokens: record.inputTokens ?? null, cachedInputTokens: record.cachedInputTokens ?? null,
      cacheWriteInputTokens: record.cacheWriteInputTokens ?? null, outputTokens: record.outputTokens ?? null,
      reasoningTokens: record.reasoningTokens ?? null, usageSource: record.usageSource ?? "unknown",
      costEstimateUsd: record.costEstimateUsd ?? null });
    if (this.data.requests.length > 1000) this.data.requests.splice(0, this.data.requests.length - 1000);
    this.save();
  }
  listRequests(): RequestRecord[] { return this.data.requests.slice().reverse(); }
  clearRequests(): number {
    const previous = this.data.requests;
    this.data.requests = [];
    try { this.save(); } catch (error) { this.data.requests = previous; throw error; }
    return previous.length;
  }
  clearUsage(): { deletedDays: number; trackingStartedAt: string } {
    const previous = this.data.usage!;
    const ledger = newUsageLedger(false);
    ledger.coverage = "since-reset";
    this.data.usage = ledger;
    try { this.save(); } catch (error) { this.data.usage = previous; throw error; }
    return { deletedDays: previous.days.length, trackingStartedAt: ledger.trackingStartedAt };
  }
  usage() { return usageReport(this.data.usage!); }
  summary(): { requestsToday: number; errorsToday: number; averageLatencyMs: number; activeKeys: number } {
    const today = new Date().toISOString().slice(0, 10);
    const bucket = this.data.usage!.days.find((item) => item.day === today);
    return {
      requestsToday: bucket?.requests ?? 0,
      errorsToday: bucket?.errors ?? 0,
      averageLatencyMs: bucket?.durationKnown ? Math.round(bucket.durationMs / bucket.durationKnown) : 0,
      activeKeys: this.data.keys.filter((key) => !key.revokedAt).length,
    };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = join(dirname(this.file), `.${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
    this.changeRevision++;
  }
}
