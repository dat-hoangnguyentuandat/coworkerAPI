import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const scripts = new URL("../scripts/", import.meta.url);
const candidates = readdirSync(scripts).filter(name => /^live-.*-e2e\.mjs$/.test(name));
const fixtures = [
  { configured: "http://127.0.0.1:3213", destination: "http://127.0.0.1:3213", allowed: true },
  { configured: "http://127.0.0.1:3213/v1", destination: "http://127.0.0.1:3213/other", allowed: true },
  { configured: "http://127.0.0.1:3213", destination: "http://127.0.0.1:3212", allowed: false },
  { configured: "http://127.0.0.1:3213", destination: "https://127.0.0.1:3213", allowed: false },
  { configured: "https://127.0.0.1:3213", destination: "http://127.0.0.1:3213", allowed: false },
  { configured: "http://localhost:3213", destination: "http://127.0.0.1:3213", allowed: false },
  { configured: "https://example.invalid:443/v1", destination: "https://example.invalid", allowed: true },
  { configured: "http://example.invalid:80/v1", destination: "http://example.invalid", allowed: true },
];

for (const name of candidates) {
  const source = readFileSync(new URL(name, scripts), "utf8");
  if (!source.includes("settings.env") || !source.includes("ANTHROPIC_AUTH_TOKEN")) continue;
  test(`${name}: automatic credential reuse requires matching scheme, host, and port`, () => {
    // Extract only the production guard, never import a script that performs live requests.
    const guard = source.match(/new URL\(([^)]*)\)\.(origin|hostname)\s*([!=]==)\s*new URL\(base\)\.(origin|hostname)/);
    assert.ok(guard, "Settings credential fallback must be guarded by URL origin comparison");
    assert.equal(guard[2], "origin", "Configured credential scope must include scheme and port");
    assert.equal(guard[4], "origin", "Destination credential scope must include scheme and port");
    assert.ok(source.includes('startsWith("cwapi_")'), "Only CoworkerAPI credentials may be reused");
    const evaluate = new Function("configuredBase", "base", "settings", `return (${guard[0]});`) as (configured: string, destination: string, settings: object) => boolean;
    for (const fixture of fixtures) {
      const comparison = evaluate(fixture.configured, fixture.destination, { env: { ANTHROPIC_BASE_URL: fixture.configured } });
      const allowed: boolean = guard[3] === "===" ? comparison : !comparison;
      assert.equal(allowed, fixture.allowed, `Unexpected automatic reuse from ${fixture.configured} to ${fixture.destination}`);
    }
  });
}
