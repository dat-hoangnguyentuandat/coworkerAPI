import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ProviderSecrets } from "../src/provider-secrets.js";
import { LocalStore } from "../src/local-store.js";

test("provider AES-GCM credentials authenticate their provider, version and ciphertext", () => {
  const vault = new ProviderSecrets(randomBytes(32).toString("hex"));
  const value = vault.encrypt("provider-a", "upstream-test-secret");
  assert.equal(vault.decrypt("provider-a", value), "upstream-test-secret");
  assert.notDeepEqual(vault.encrypt("provider-a", "upstream-test-secret"), value);
  assert.throws(() => vault.decrypt("provider-b", value), /Unable to decrypt/);
  assert.throws(() => vault.decrypt("provider-a", { ...value, ciphertext: Buffer.from("tampered").toString("base64") }), /Unable to decrypt/);
  assert.throws(() => new ProviderSecrets(randomBytes(32).toString("hex")).decrypt("provider-a", value), /Unable to decrypt/);
  assert.throws(() => new ProviderSecrets("invalid"), /64 hexadecimal/);
});

test("provider store persists encrypted keys, never exposes them in listings, and preserves credentials on metadata edits", () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkerapi-provider-storage-"));
  const master = randomBytes(32).toString("hex");
  const secret = "unique-provider-test-secret";
  const file = join(directory, "state.json");
  try {
    const store = new LocalStore(file, master);
    const provider = { id: "provider-a", name: "Test upstream", type: "openai-compatible" as const, baseUrl: "https://example.com/v1", wireApi: "responses" as const, enabled: true };
    store.upsertProvider({ ...provider, apiKey: secret } as typeof provider, secret);
    assert.ok(!readFileSync(file, "utf8").includes(secret));
    assert.ok(!JSON.stringify(store.listProviders()).includes(secret));
    assert.ok(!JSON.stringify(store.listProviders()).includes("ciphertext"));
    assert.equal(store.listProviders()[0].hasCredential, true);
    const restored = new LocalStore(file, master);
    assert.equal(restored.providerKey(provider.id), secret);
    restored.upsertProvider({ ...provider, name: "Renamed" });
    assert.equal(restored.providerKey(provider.id), secret);
    restored.upsertProvider({ ...provider, enabled: false });
    assert.equal(restored.providerKey(provider.id), undefined);
    assert.throws(() => restored.upsertProvider({ ...provider, baseUrl: "https://user:password@example.com/" }, secret), /Invalid provider base URL/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
